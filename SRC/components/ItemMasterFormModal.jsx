import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { focusNextOnEnter } from '../utils/enterKeyNextField';
import MasterPartyPickList from './MasterPartyPickList';
import MasterPartyCreateModal, { PartyAddButton } from './MasterPartyCreateModal';

const reqOpts = { withCredentials: true, timeout: 120000 };
const SALE_ACCT_SCHEDULE = 12.1;
const PURCHASE_ACCT_SCHEDULE = 14.1;

function capsField(v) {
  return String(v ?? '').toUpperCase();
}

function normalizeCodeField(v) {
  const s = String(v ?? '').trim();
  return s === '0' ? '' : s;
}

function acctLabel(r) {
  const code = r.CODE ?? r.code ?? '';
  const name = r.NAME ?? r.name ?? '';
  return name ? `[${code}] ${name}` : String(code);
}

function catLabel(r) {
  const code = r.CAT_CODE ?? r.cat_code ?? '';
  const name = r.CAT_NAME ?? r.cat_name ?? '';
  return name ? `${name} (${code})` : String(code);
}

function grpLabel(r) {
  const code = r.GRP_CODE ?? r.grp_code ?? '';
  const name = r.GRP_NAME ?? r.grp_name ?? '';
  return name ? `${name} (${code})` : String(code);
}

function FieldLabel({ children, required = false }) {
  return (
    <span className="item-master-label">
      {children}
      {required ? <span className="item-master-label__req"> *</span> : null}
    </span>
  );
}

function FormSection({ title, hint, children }) {
  return (
    <section className="item-master-section">
      <div className="item-master-section__head">
        <h4 className="item-master-section__title">{title}</h4>
        {hint ? <p className="item-master-section__hint">{hint}</p> : null}
      </div>
      <div className="item-master-section__body">{children}</div>
    </section>
  );
}

export default function ItemMasterFormModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  compYear,
  userName,
  editRow = null,
  onCreated,
  onUpdated,
}) {
  const isEdit = editRow != null;
  const formRef = useRef(null);

  const [perms, setPerms] = useState(null);
  const [partyPerms, setPartyPerms] = useState(null);
  const [cats, setCats] = useState([]);
  const [itemGroups, setItemGroups] = useState([]);
  const [saleAccounts, setSaleAccounts] = useState([]);
  const [purchaseAccounts, setPurchaseAccounts] = useState([]);

  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [cat, setCat] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');
  const [grpCode, setGrpCode] = useState('');
  const [grpName, setGrpName] = useState('');
  const [hsnCode, setHsnCode] = useState('');
  const [hsnName, setHsnName] = useState('');
  const [hsnUnit, setHsnUnit] = useState('');
  const [taxPer, setTaxPer] = useState('');
  const [sCode, setSCode] = useState('');
  const [pCode, setPCode] = useState('');
  const [itemHead, setItemHead] = useState('');
  const [sapCodeR1, setSapCodeR1] = useState('');
  const [sapCodeR2, setSapCodeR2] = useState('');
  const [bardItemCode, setBardItemCode] = useState('');
  const [bardOpStock, setBardOpStock] = useState('');
  const [bardOpRate, setBardOpRate] = useState('');
  const [bardOpValue, setBardOpValue] = useState('');
  const [uItemCode, setUItemCode] = useState('');
  const [tdgQW, setTdgQW] = useState('W');
  const [unitType, setUnitType] = useState('Q');
  const [commission, setCommission] = useState('');
  const [brokerage, setBrokerage] = useState('');
  const [brokCal, setBrokCal] = useState('Q');
  const [saleRate, setSaleRate] = useState('');
  const [packing, setPacking] = useState('');
  const [unit, setUnit] = useState('');
  const [amtCal, setAmtCal] = useState('W');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saleAddOpen, setSaleAddOpen] = useState(false);
  const [purchaseAddOpen, setPurchaseAddOpen] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);

  const loadLookups = useCallback(async () => {
    const { data } = await axios.get(`${apiBase}/api/item-master-lookups`, {
      params: { comp_code: compCode, comp_uid: compUid },
      ...reqOpts,
    });
    setCats(data?.cats || []);
    setItemGroups(data?.itemGroups || []);
    setSaleAccounts(data?.saleAccounts || []);
    setPurchaseAccounts(data?.purchaseAccounts || []);
    return data;
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    if (!open) return;

    if (isEdit) {
      setItemCode(String(editRow.ITEM_CODE ?? editRow.item_code ?? ''));
      setItemName(String(editRow.ITEM_NAME ?? editRow.item_name ?? ''));
      setCat(String(editRow.CAT ?? editRow.cat ?? ''));
      setGrpCode(String(editRow.GRP_CODE ?? editRow.grp_code ?? ''));
      setGrpName(String(editRow.GRP_NAME ?? editRow.grp_name ?? ''));
      setCatCode(String(editRow.CAT_CODE ?? editRow.cat_code ?? ''));
      setCatName(String(editRow.CAT_NAME ?? editRow.cat_name ?? ''));
      setHsnCode(String(editRow.HSN_CODE ?? editRow.hsn_code ?? ''));
      setHsnName(String(editRow.HSN_NAME ?? editRow.hsn_name ?? ''));
      setHsnUnit(String(editRow.HSN_UNIT ?? editRow.hsn_unit ?? ''));
      setTaxPer(String(editRow.TAX_PER ?? editRow.tax_per ?? ''));
      setSCode(normalizeCodeField(editRow.S_CODE ?? editRow.s_code ?? ''));
      setPCode(normalizeCodeField(editRow.P_CODE ?? editRow.p_code ?? ''));
      setItemHead(String(editRow.ITEM_HEAD ?? editRow.item_head ?? ''));
      setSapCodeR1(String(editRow.SAP_CODE_R1 ?? editRow.sap_code_r1 ?? ''));
      setSapCodeR2(String(editRow.SAP_CODE_R2 ?? editRow.sap_code_r2 ?? ''));
      setBardItemCode(String(editRow.BARD_ITEM_CODE ?? editRow.bard_item_code ?? ''));
      setBardOpStock(String(editRow.BARD_OP_STOCK ?? editRow.bard_op_stock ?? ''));
      setBardOpRate(String(editRow.BARD_OP_RATE ?? editRow.bard_op_rate ?? ''));
      setBardOpValue(String(editRow.BARD_OP_VALUE ?? editRow.bard_op_value ?? ''));
      setUItemCode(String(editRow.U_ITEM_CODE ?? editRow.u_item_code ?? ''));
      setTdgQW(String(editRow.TDG_Q_W ?? editRow.tdg_q_w ?? 'W').toUpperCase() || 'W');
      setUnitType(String(editRow.UNIT_TYPE ?? editRow.unit_type ?? 'Q').toUpperCase() || 'Q');
      setCommission(String(editRow.COMMISSION ?? editRow.commission ?? ''));
      setBrokerage(String(editRow.BROKERAGE ?? editRow.brokerage ?? ''));
      setBrokCal(String(editRow.BROK_CAL ?? editRow.brok_cal ?? 'Q').toUpperCase() || 'Q');
      setSaleRate(String(editRow.SALE_RATE ?? editRow.sale_rate ?? ''));
      setPacking(String(editRow.PACKING ?? editRow.packing ?? ''));
      setUnit(String(editRow.UNIT ?? editRow.unit ?? ''));
      setAmtCal(String(editRow.AMT_CAL ?? editRow.amt_cal ?? 'W').toUpperCase() || 'W');
    } else {
      setItemCode('');
      setItemName('');
      setCat('');
      setGrpCode('');
      setGrpName('');
      setCatCode('');
      setCatName('');
      setHsnCode('');
      setHsnName('');
      setHsnUnit('');
      setTaxPer('');
      setSCode('');
      setPCode('');
      setItemHead('');
      setSapCodeR1('');
      setSapCodeR2('');
      setBardItemCode('');
      setBardOpStock('');
      setBardOpRate('');
      setBardOpValue('');
      setUItemCode('');
      setTdgQW('W');
      setUnitType('Q');
      setCommission('');
      setBrokerage('');
      setBrokCal('Q');
      setSaleRate('');
      setPacking('');
      setUnit('');
      setAmtCal('W');
    }
    setErr('');
    setSaving(false);

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [pRes, partyRes] = await Promise.all([
          axios.get(`${apiBase}/api/item-master-user-permissions`, {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(`${apiBase}/api/master-party-user-permissions`, {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
        ]);
        await loadLookups();
        if (!isEdit) {
          setCodeLoading(true);
          try {
            const { data: nextCode } = await axios.get(`${apiBase}/api/item-master-next-code`, {
              params: { comp_code: compCode, comp_uid: compUid },
              ...reqOpts,
            });
            setItemCode(String(nextCode?.next_code ?? nextCode?.NEXT_CODE ?? ''));
          } catch {
            /* keep manual input fallback if endpoint not reachable */
          } finally {
            setCodeLoading(false);
          }
        }
        if (cancelled) return;
        setPerms(pRes.data);
        setPartyPerms(partyRes.data);
        if (!pRes.data?.canOpen) {
          setErr('Access Denied');
          return;
        }
        if (isEdit) {
          if (!pRes.data?.canEdit) setErr('You Can Not Edit');
        } else if (!pRes.data?.canAdd) {
          setErr('You Can Not Add');
        }
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, compUid, userName, isEdit, editRow, loadLookups]);

  const handleCatChange = (code) => {
    setCatCode(code);
    const hit = cats.find((c) => String(c.CAT_CODE ?? c.cat_code ?? '') === String(code));
    if (hit) {
      setCatName(String(hit.CAT_NAME ?? hit.cat_name ?? ''));
      const catChar = String(hit.CAT ?? hit.cat ?? hit.MAIN_CAT ?? hit.main_cat ?? '').trim();
      if (catChar) setCat(catChar.slice(0, 1).toUpperCase());
    } else {
      setCatName('');
    }
  };

  const handleGrpChange = (code) => {
    setGrpCode(code);
    const hit = itemGroups.find((g) => String(g.GRP_CODE ?? g.grp_code ?? '') === String(code));
    if (hit) {
      setGrpName(String(hit.GRP_NAME ?? hit.grp_name ?? ''));
      const catChar = String(hit.CAT ?? hit.cat ?? '').trim();
      if (catChar) setCat(catChar.slice(0, 1).toUpperCase());
    } else {
      setGrpName('');
    }
  };

  const refreshAccountsAfterParty = async (created, schedule) => {
    const data = await loadLookups();
    const code = created?.code ?? created?.CODE;
    if (code != null) {
      if (schedule === SALE_ACCT_SCHEDULE) setSCode(String(code));
      if (schedule === PURCHASE_ACCT_SCHEDULE) setPCode(String(code));
    }
    return data;
  };

  const blocked = !perms?.canOpen || (isEdit ? !perms?.canEdit : !perms?.canAdd);

  const handleSave = async (e) => {
    e.preventDefault();
    if (blocked) return;
    if (!String(itemCode).trim()) {
      setErr('Item code is required.');
      return;
    }
    if (!String(itemName).trim()) {
      setErr('Item name is required.');
      return;
    }
    const ac = String(amtCal).trim().toUpperCase();
    if (ac !== 'Q' && ac !== 'W' && ac !== 'K') {
      setErr('Amt basis must be Q, W, or K.');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      item_code: capsField(itemCode).trim(),
      item_name: capsField(itemName).trim(),
      cat: capsField(cat).trim(),
      cat_code: capsField(catCode).trim(),
      grp_code: capsField(grpCode).trim(),
      hsn_code: capsField(hsnCode).trim(),
      hsn_name: capsField(hsnName).trim(),
      hsn_unit: capsField(hsnUnit).trim(),
      tax_per: Number(taxPer) || 0,
      s_code: normalizeCodeField(capsField(sCode).trim()),
      p_code: normalizeCodeField(capsField(pCode).trim()),
      item_head: capsField(itemHead).trim(),
      sap_code_r1: capsField(sapCodeR1).trim(),
      sap_code_r2: capsField(sapCodeR2).trim(),
      bard_item_code: Number(bardItemCode) || 0,
      bard_op_stock: Number(bardOpStock) || 0,
      bard_op_rate: Number(bardOpRate) || 0,
      bard_op_value: Number(bardOpValue) || 0,
      u_item_code: capsField(uItemCode).trim(),
      tdg_q_w: capsField(tdgQW).trim(),
      unit_type: capsField(unitType).trim(),
      commission: Number(commission) || 0,
      brokerage: Number(brokerage) || 0,
      brok_cal: capsField(brokCal).trim(),
      sale_rate: Number(saleRate) || 0,
      packing: Number(packing) || 0,
      unit: capsField(unit).trim(),
      amt_cal: ac,
    };
    try {
      if (isEdit) {
        const { data } = await axios.put(`${apiBase}/api/item-master`, payload, reqOpts);
        alert('Item updated successfully.');
        onUpdated?.(data);
      } else {
        const { data } = await axios.post(`${apiBase}/api/item-master`, payload, reqOpts);
        alert('Item inserted successfully.');
        onCreated?.(data);
      }
      onClose?.();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      if (ex?.response?.status === 403 || ex?.response?.status === 409) alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleFormEnterAsTab = useCallback(
    (e) => {
      focusNextOnEnter(e, formRef, { submitOnLast: true });
    },
    []
  );

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="sale-bill-modal-backdrop master-party-modal-backdrop item-master-modal-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div className="sale-bill-modal master-party-modal item-master-modal" role="dialog" aria-labelledby="item-master-modal-title">
          <div className="sale-bill-modal-head item-master-modal__head">
            <div className="item-master-modal__head-text">
              <h3 id="item-master-modal-title">{isEdit ? 'Edit item' : 'New item'}</h3>
              <p className="item-master-modal__subtitle">Item Master · maintain ITEMMAST records</p>
            </div>
            <button type="button" className="sale-bill-modal-close item-master-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <form ref={formRef} className="item-master-modal__body" onSubmit={handleSave} onKeyDownCapture={handleFormEnterAsTab}>
            {loading ? <p className="master-party-modal__loading item-master-modal__loading">Loading…</p> : null}
            {err ? <p className="deploy-update-msg deploy-update-msg--err item-master-modal__err">{err}</p> : null}
            {!loading && !blocked ? (
              <div className="item-master-modal__scroll">
              <div className="item-master-form">
                <FormSection title="Item details">
                  <div className="item-master-form__grid item-master-form__grid--identity">
                    <label className="item-master-field item-master-field--code">
                      <FieldLabel required>Item code</FieldLabel>
                      <input
                        className={`form-input item-master-input item-master-input--readonly`}
                        value={itemCode}
                        maxLength={13}
                        readOnly
                        disabled={saving || isEdit || codeLoading}
                        placeholder={codeLoading ? 'Loading next code…' : 'Auto'}
                        onChange={(e) => setItemCode(capsField(e.target.value))}
                      />
                    </label>
                    <label className="item-master-field item-master-field--grow">
                      <FieldLabel required>Item name</FieldLabel>
                      <input
                        className="form-input item-master-input"
                        value={itemName}
                        maxLength={50}
                        disabled={saving}
                        placeholder="Description"
                        onChange={(e) => setItemName(capsField(e.target.value))}
                      />
                    </label>
                  </div>
                  <div className="item-master-form__grid">
                    <label className="item-master-field item-master-field--grow">
                      <FieldLabel>Category</FieldLabel>
                      <MasterPartyPickList
                        options={itemGroups}
                        value={grpCode}
                        disabled={saving}
                        title="Category"
                        placeholder="Select category"
                        filterPlaceholder="Search category…"
                        getValue={(g) => String(g.GRP_CODE ?? g.grp_code ?? '')}
                        getLabel={grpLabel}
                        onChange={handleGrpChange}
                        showSearchIcon
                        showAllWhenEmpty
                      />
                    </label>
                  </div>
                  <div className="item-master-form__grid">
                    <label className="item-master-field item-master-field--grow">
                      <FieldLabel>Item Group</FieldLabel>
                      <MasterPartyPickList
                        options={cats}
                        value={catCode}
                        disabled={saving}
                        title="Item Group"
                        placeholder="Select item group"
                        filterPlaceholder="Search item group…"
                        getValue={(c) => String(c.CAT_CODE ?? c.cat_code ?? '')}
                        getLabel={catLabel}
                        onChange={handleCatChange}
                        showSearchIcon
                        showAllWhenEmpty
                      />
                    </label>
                  </div>
                </FormSection>

                <FormSection title="Tax & amount basis" hint="HSN/GST for returns · amount on Q or W">
                  <div className="item-master-form__grid item-master-form__grid--tax">
                    <label className="item-master-field">
                      <FieldLabel>HSN code</FieldLabel>
                      <input
                        className="form-input item-master-input"
                        value={hsnCode}
                        maxLength={8}
                        disabled={saving}
                        placeholder="8 digits"
                        onChange={(e) => setHsnCode(capsField(e.target.value))}
                      />
                    </label>
                    <label className="item-master-field item-master-field--pct">
                      <FieldLabel>GST %</FieldLabel>
                      <input
                        className="form-input item-master-input item-master-input--num"
                        type="number"
                        step="0.01"
                        min="0"
                        value={taxPer}
                        disabled={saving}
                        placeholder="0"
                        onChange={(e) => setTaxPer(e.target.value)}
                      />
                    </label>
                    <label className="item-master-field">
                      <FieldLabel>HSN name</FieldLabel>
                      <input className="form-input item-master-input" value={hsnName} disabled={saving} onChange={(e) => setHsnName(capsField(e.target.value))} />
                    </label>
                    <label className="item-master-field">
                      <FieldLabel>HSN unit</FieldLabel>
                      <input className="form-input item-master-input" value={hsnUnit} disabled={saving} onChange={(e) => setHsnUnit(capsField(e.target.value))} />
                    </label>
                    <label className="item-master-field item-master-field--amtcal">
                      <FieldLabel required>Amt basis</FieldLabel>
                      <select className="form-input item-master-input" value={amtCal} disabled={saving} onChange={(e) => setAmtCal(e.target.value)}>
                        <option value="Q">(Q) Qty</option>
                        <option value="W">(W) Weight*Rate/100</option>
                        <option value="K">(K) Weight*Rate</option>
                      </select>
                    </label>
                  </div>
                </FormSection>

                <FormSection title="VFP item fields">
                  <div className="item-master-form__grid item-master-form__grid--tax">
                    <label className="item-master-field"><FieldLabel>Item Head</FieldLabel><input className="form-input item-master-input" value={itemHead} disabled={saving} onChange={(e) => setItemHead(capsField(e.target.value))} /></label>
                    <label className="item-master-field"><FieldLabel>Sap Code R1</FieldLabel><input className="form-input item-master-input" value={sapCodeR1} disabled={saving} onChange={(e) => setSapCodeR1(capsField(e.target.value))} /></label>
                    <label className="item-master-field"><FieldLabel>Sap Code R2</FieldLabel><input className="form-input item-master-input" value={sapCodeR2} disabled={saving} onChange={(e) => setSapCodeR2(capsField(e.target.value))} /></label>
                    <label className="item-master-field"><FieldLabel>Bard Item Code</FieldLabel><input className="form-input item-master-input" type="number" value={bardItemCode} disabled={saving} onChange={(e) => setBardItemCode(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Bard Op.Stock</FieldLabel><input className="form-input item-master-input" type="number" value={bardOpStock} disabled={saving} onChange={(e) => setBardOpStock(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Op.Rate</FieldLabel><input className="form-input item-master-input" type="number" value={bardOpRate} disabled={saving} onChange={(e) => setBardOpRate(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Op.Value</FieldLabel><input className="form-input item-master-input" type="number" value={bardOpValue} disabled={saving} onChange={(e) => setBardOpValue(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Udaan Item Code</FieldLabel><input className="form-input item-master-input" value={uItemCode} disabled={saving} onChange={(e) => setUItemCode(capsField(e.target.value))} /></label>
                    <label className="item-master-field">
                      <FieldLabel>Tdg Qty/Wgt</FieldLabel>
                      <select className="form-input item-master-input" value={tdgQW} disabled={saving} onChange={(e) => setTdgQW(e.target.value)}>
                        <option value="Q">(Q) Qty</option>
                        <option value="W">(W) Weight</option>
                      </select>
                    </label>
                    <label className="item-master-field">
                      <FieldLabel>Unit Type</FieldLabel>
                      <select className="form-input item-master-input" value={unitType} disabled={saving} onChange={(e) => setUnitType(e.target.value)}>
                        <option value="Q">(Q) nt</option>
                        <option value="K">(K) gs</option>
                        <option value="P">(P) cs</option>
                      </select>
                    </label>
                    <label className="item-master-field"><FieldLabel>Commission</FieldLabel><input className="form-input item-master-input" type="number" value={commission} disabled={saving} onChange={(e) => setCommission(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Brokerage</FieldLabel><input className="form-input item-master-input" type="number" value={brokerage} disabled={saving} onChange={(e) => setBrokerage(e.target.value)} /></label>
                    <label className="item-master-field">
                      <FieldLabel>Brok Cal</FieldLabel>
                      <select className="form-input item-master-input" value={brokCal} disabled={saving} onChange={(e) => setBrokCal(e.target.value)}>
                        <option value="Q">(Q)</option>
                        <option value="W">(W)</option>
                        <option value="A">(A)</option>
                      </select>
                    </label>
                    <label className="item-master-field"><FieldLabel>Sale Rate</FieldLabel><input className="form-input item-master-input" type="number" value={saleRate} disabled={saving} onChange={(e) => setSaleRate(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Packing</FieldLabel><input className="form-input item-master-input" type="number" value={packing} disabled={saving} onChange={(e) => setPacking(e.target.value)} /></label>
                    <label className="item-master-field"><FieldLabel>Unit</FieldLabel><input className="form-input item-master-input" value={unit} disabled={saving} onChange={(e) => setUnit(capsField(e.target.value))} /></label>
                  </div>
                </FormSection>

                <FormSection title="Ledger accounts" hint="Sale 12.10 · Purchase 14.10 — use + to add A/c">
                  <label className="item-master-field item-master-field--full">
                    <FieldLabel>Sale account</FieldLabel>
                    <div className="item-master-input-group">
                      <MasterPartyPickList
                        options={saleAccounts}
                        value={sCode}
                        disabled={saving}
                        title="Sale account"
                        placeholder="Select sale GL account"
                        filterPlaceholder="Search by name or code…"
                        getValue={(a) => String(a.CODE ?? a.code ?? '')}
                        getLabel={acctLabel}
                        onChange={setSCode}
                      />
                      <PartyAddButton
                        onClick={() => setSaleAddOpen(true)}
                        disabled={saving || !partyPerms?.canAdd}
                        title="Add sale account (schedule 12.10)"
                      />
                    </div>
                  </label>

                  <label className="item-master-field item-master-field--full">
                    <FieldLabel>Purchase account</FieldLabel>
                    <div className="item-master-input-group">
                      <MasterPartyPickList
                        options={purchaseAccounts}
                        value={pCode}
                        disabled={saving}
                        title="Purchase account"
                        placeholder="Select purchase GL account"
                        filterPlaceholder="Search by name or code…"
                        getValue={(a) => String(a.CODE ?? a.code ?? '')}
                        getLabel={acctLabel}
                        onChange={setPCode}
                      />
                      <PartyAddButton
                        onClick={() => setPurchaseAddOpen(true)}
                        disabled={saving || !partyPerms?.canAdd}
                        title="Add purchase account (schedule 14.10)"
                      />
                    </div>
                  </label>
                </FormSection>
              </div>
              </div>
            ) : null}
            <div className="item-master-modal__foot">
              <button type="button" className="btn btn-secondary item-master-modal__btn-cancel" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary item-master-modal__btn-save" disabled={saving || blocked || loading}>
                {saving ? 'Saving…' : isEdit ? 'Update item' : 'Save item'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <MasterPartyCreateModal
        open={saleAddOpen}
        onClose={() => setSaleAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={SALE_ACCT_SCHEDULE}
        lockSchedule
        onCreated={(data) => {
          setSaleAddOpen(false);
          void refreshAccountsAfterParty(data, SALE_ACCT_SCHEDULE);
        }}
      />

      <MasterPartyCreateModal
        open={purchaseAddOpen}
        onClose={() => setPurchaseAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={PURCHASE_ACCT_SCHEDULE}
        lockSchedule
        onCreated={(data) => {
          setPurchaseAddOpen(false);
          void refreshAccountsAfterParty(data, PURCHASE_ACCT_SCHEDULE);
        }}
      />
    </>,
    document.body
  );
}
