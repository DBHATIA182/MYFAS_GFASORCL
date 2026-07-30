import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import { toDisplayDate, toOracleDate } from '../utils/dateFormat';
import {
  downloadDispatchChallanChecklistExcel,
  exportDispatchChallanChecklistPdf,
  printDispatchChallanChecklist,
  shareDispatchChallanChecklistWhatsApp,
} from '../utils/dispatchChallanChecklistReport';

const reqOpts = { withCredentials: true, timeout: 120000 };

const CITY_HELP_COLUMNS = [{ key: 'city', label: 'City' }];

function emptyFilters(fyMinYmd, fyMaxYmd) {
  return {
    sdt: fyMinYmd || '',
    edt: fyMaxYmd || '',
    sbno: '0',
    ebno: '0',
    code: '',
    party_name: '',
    item_code: '',
    item_name: '',
    sup_code: '',
    sup_name: '',
    mlc: '',
    bk_code: '',
    bk_name: '',
    city: '',
    b_type: '',
  };
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * VFP DO FORM dcchk / PROCEDURE DCCHK (dchalan.prg) / report dcchk.frx
 * Filters: date, bill no, party, item, supplier, L/C, broker, city, bill type.
 */
export default function DispatchChallanChecklistModal({
  open,
  apiBase,
  apiParams,
  fyMinYmd = '',
  fyMaxYmd = '',
  formData,
  userName,
  dcType = 'DC',
  parties = [],
  brokers = [],
  suppliers = [],
  items = [],
  onSelect,
  onClose,
}) {
  const isReturn = String(dcType).toUpperCase() === 'DR';
  const entryTitle = isReturn ? 'DISPATCH CHALLAN RETURN LIST' : 'DISPATCH CHALLAN LIST';

  const [step, setStep] = useState('entry');
  const [filters, setFilters] = useState(() => emptyFilters(fyMinYmd, fyMaxYmd));
  const [rows, setRows] = useState([]);
  const [headName, setHeadName] = useState(entryTitle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [helpField, setHelpField] = useState(null);
  const [itemHelpOpen, setItemHelpOpen] = useState(false);
  const [cityHelpOpen, setCityHelpOpen] = useState(false);
  const [cities, setCities] = useState([]);

  const fromDateRef = useRef(null);
  const toDateRef = useRef(null);
  const sbnoRef = useRef(null);
  const ebnoRef = useRef(null);
  const codeRef = useRef(null);
  const itemRef = useRef(null);
  const supRef = useRef(null);
  const mlcRef = useRef(null);
  const bkRef = useRef(null);
  const cityRef = useRef(null);
  const btypeRef = useRef(null);

  const totals = useMemo(() => {
    let bags = 0;
    let katta = 0;
    let hkatta = 0;
    let weight = 0;
    let amount = 0;
    for (const row of rows) {
      const st = String(row.status || 'B').toUpperCase();
      const q = num(row.qnty);
      bags += num(row.bags) || (st === 'B' ? q : 0);
      katta += num(row.katta) || (st === 'K' ? q : 0);
      hkatta += num(row.hkatta) || (st === 'H' ? q : 0);
      weight += num(row.weight);
      amount += num(row.amount);
    }
    return { bags, katta, hkatta, weight, amount };
  }, [rows]);

  const resetAndOpen = () => {
    setStep('entry');
    setFilters(emptyFilters(fyMinYmd, fyMaxYmd));
    setRows([]);
    setHeadName(entryTitle);
    setError('');
    setExportErr('');
    setHighlight(0);
    setHelpField(null);
    setItemHelpOpen(false);
    setCityHelpOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    resetAndOpen();
  }, [open, fyMinYmd, fyMaxYmd, entryTitle]);

  const moveFocus = (ref) => window.setTimeout(() => ref?.current?.focus(), 0);

  const openCityHelp = async () => {
    setCityHelpOpen(true);
    if (cities.length) return;
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan/checklist-cities`, {
        params: apiParams,
        ...reqOpts,
      });
      setCities(Array.isArray(data?.rows) ? data.rows : []);
    } catch {
      setCities([]);
    }
  };

  const runChecklist = async () => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan/checklist`, {
        params: {
          ...apiParams,
          dc_type: dcType,
          sdt: toOracleDate(filters.sdt),
          edt: toOracleDate(filters.edt),
          sbno: filters.sbno || 0,
          ebno: filters.ebno || 0,
          code: filters.code || undefined,
          item_code: filters.item_code || undefined,
          sup_code: filters.sup_code || undefined,
          bk_code: filters.bk_code || undefined,
          mlc: filters.mlc || undefined,
          city: filters.city || undefined,
          b_type: filters.b_type || undefined,
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []);
      setHeadName(data?.head_name || entryTitle);
      setHighlight(0);
      setStep('report');
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.error || err.message || 'Checklist failed.');
    } finally {
      setLoading(false);
    }
  };

  const exportCtx = useMemo(
    () => ({
      rows,
      filters,
      headName,
      formData,
      userName,
      compCode: apiParams?.comp_code,
      compUid: apiParams?.comp_uid,
    }),
    [apiParams, filters, formData, headName, rows, userName]
  );

  const canExport = rows.length > 0;

  const runExport = async (fn) => {
    if (!canExport) return;
    setExportErr('');
    try {
      await fn(apiBase, exportCtx);
    } catch (err) {
      setExportErr(err?.message || String(err));
    }
  };

  const pickAccount = (field, code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const pool = field === 'bk_code' ? brokers : field === 'sup_code' ? suppliers : parties;
    const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
    const name = String(row?.NAME ?? row?.name ?? '').trim();
    if (field === 'code') setFilters((f) => ({ ...f, code: c, party_name: name }));
    if (field === 'bk_code') setFilters((f) => ({ ...f, bk_code: c, bk_name: name }));
    if (field === 'sup_code') setFilters((f) => ({ ...f, sup_code: c, sup_name: name }));
    setHelpField(null);
  };

  const helpAccounts =
    helpField === 'bk_code' ? brokers : helpField === 'sup_code' ? suppliers : parties;
  const helpTitle =
    helpField === 'bk_code'
      ? 'Broker help'
      : helpField === 'sup_code'
        ? 'Supplier help (S codes)'
        : 'Party / Code help';

  if (!open) return null;

  const isReport = step === 'report';

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label={entryTitle}>
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`voucher-help-modal__panel voucher-help-modal__panel--account purchase-order-checklist-modal${
          isReport ? ' purchase-order-checklist-modal--report' : ''
        }`}
        style={isReport ? { width: 'min(1100px, 98vw)' } : undefined}
      >
        <header className="voucher-help-modal__head purchase-order-checklist-modal__head">
          <h3 className="voucher-help-modal__title">{isReport ? `${headName}` : entryTitle}</h3>
          <button type="button" className="voucher-help-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!isReport ? (
          <div className="purchase-order-checklist-modal__entry">
            <div className="purchase-order-checklist-modal__filters">
              <label className="purchase-order-checklist-modal__field">
                <span>Starting Date</span>
                <VoucherDmyDateInput
                  valueYmd={filters.sdt}
                  onChangeYmd={(v) => setFilters((f) => ({ ...f, sdt: v }))}
                  minYmd={fyMinYmd}
                  maxYmd={fyMaxYmd}
                  inputRef={fromDateRef}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(toDateRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field">
                <span>Ending Date</span>
                <VoucherDmyDateInput
                  valueYmd={filters.edt}
                  onChangeYmd={(v) => setFilters((f) => ({ ...f, edt: v }))}
                  minYmd={fyMinYmd}
                  maxYmd={fyMaxYmd}
                  inputRef={toDateRef}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(sbnoRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field">
                <span>Starting Bill No.</span>
                <input
                  ref={sbnoRef}
                  className="form-input"
                  value={filters.sbno}
                  onChange={(e) => setFilters((f) => ({ ...f, sbno: e.target.value.replace(/[^\d]/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(ebnoRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field">
                <span>Ending Bill No.</span>
                <input
                  ref={ebnoRef}
                  className="form-input"
                  value={filters.ebno}
                  onChange={(e) => setFilters((f) => ({ ...f, ebno: e.target.value.replace(/[^\d]/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(codeRef)}
                />
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Code</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={codeRef}
                    className="form-input"
                    value={filters.code}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, code: e.target.value.toUpperCase(), party_name: '' }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('code');
                      }
                      if (e.key === 'Enter') moveFocus(itemRef);
                    }}
                  />
                  <button type="button" className="voucher-entry-form__code-help-btn" onClick={() => setHelpField('code')}>
                    🔍
                  </button>
                  <input className="form-input" value={filters.party_name} readOnly tabIndex={-1} placeholder="Name" />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Item</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={itemRef}
                    className="form-input"
                    value={filters.item_code}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        item_code: e.target.value.replace(/[^\d]/g, ''),
                        item_name: '',
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setItemHelpOpen(true);
                      }
                      if (e.key === 'Enter') moveFocus(supRef);
                    }}
                  />
                  <button type="button" className="voucher-entry-form__code-help-btn" onClick={() => setItemHelpOpen(true)}>
                    🔍
                  </button>
                  <input className="form-input" value={filters.item_name} readOnly tabIndex={-1} placeholder="Item name" />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Supplier</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={supRef}
                    className="form-input"
                    value={filters.sup_code}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, sup_code: e.target.value.toUpperCase(), sup_name: '' }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('sup_code');
                      }
                      if (e.key === 'Enter') moveFocus(mlcRef);
                    }}
                  />
                  <button
                    type="button"
                    className="voucher-entry-form__code-help-btn"
                    onClick={() => setHelpField('sup_code')}
                  >
                    🔍
                  </button>
                  <input className="form-input" value={filters.sup_name} readOnly tabIndex={-1} placeholder="Supplier" />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field">
                <span>(L)ocal / (C)entral</span>
                <input
                  ref={mlcRef}
                  className="form-input"
                  maxLength={1}
                  value={filters.mlc}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      mlc: e.target.value.toUpperCase().replace(/[^LC]/g, '').slice(0, 1),
                    }))
                  }
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(bkRef)}
                />
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Broker</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={bkRef}
                    className="form-input"
                    value={filters.bk_code}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, bk_code: e.target.value.toUpperCase(), bk_name: '' }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('bk_code');
                      }
                      if (e.key === 'Enter') moveFocus(cityRef);
                    }}
                  />
                  <button
                    type="button"
                    className="voucher-entry-form__code-help-btn"
                    onClick={() => setHelpField('bk_code')}
                  >
                    🔍
                  </button>
                  <input className="form-input" value={filters.bk_name} readOnly tabIndex={-1} placeholder="Broker" />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field">
                <span>City</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={cityRef}
                    className="form-input"
                    value={filters.city}
                    onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value.toUpperCase() }))}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        void openCityHelp();
                      }
                      if (e.key === 'Enter') moveFocus(btypeRef);
                    }}
                  />
                  <button type="button" className="voucher-entry-form__code-help-btn" onClick={() => void openCityHelp()}>
                    🔍
                  </button>
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field">
                <span>Bill Type</span>
                <input
                  ref={btypeRef}
                  className="form-input"
                  maxLength={1}
                  value={filters.b_type}
                  onChange={(e) => setFilters((f) => ({ ...f, b_type: e.target.value.toUpperCase().slice(0, 1) }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runChecklist();
                  }}
                />
              </label>
            </div>

            {error ? <p className="deploy-update-msg deploy-update-msg--err">{error}</p> : null}

            <div className="purchase-order-checklist-modal__actions">
              <button type="button" className="btn btn-sm btn-primary" disabled={loading} onClick={() => void runChecklist()}>
                {loading ? 'Loading…' : 'Proceed'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={loading}
                onClick={async () => {
                  setLoading(true);
                  setError('');
                  try {
                    const { data } = await axios.get(`${apiBase}/api/dispatch-challan/checklist`, {
                      params: {
                        ...apiParams,
                        dc_type: dcType,
                        sdt: toOracleDate(filters.sdt),
                        edt: toOracleDate(filters.edt),
                        sbno: filters.sbno || 0,
                        ebno: filters.ebno || 0,
                        code: filters.code || undefined,
                        item_code: filters.item_code || undefined,
                        sup_code: filters.sup_code || undefined,
                        bk_code: filters.bk_code || undefined,
                        mlc: filters.mlc || undefined,
                        city: filters.city || undefined,
                        b_type: filters.b_type || undefined,
                      },
                      ...reqOpts,
                    });
                    const list = Array.isArray(data?.rows) ? data.rows : [];
                    const hn = data?.head_name || entryTitle;
                    setRows(list);
                    setHeadName(hn);
                    downloadDispatchChallanChecklistExcel({
                      rows: list,
                      filters,
                      headName: hn,
                      formData,
                    });
                    setStep('report');
                  } catch (err) {
                    setError(err.response?.data?.error || err.message || 'Excel export failed.');
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Excel
              </button>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Quit
              </button>
            </div>
          </div>
        ) : (
          <div className="purchase-order-checklist-modal__report">
            <div className="purchase-order-checklist-modal__actions" style={{ padding: '0.35rem 0.75rem' }}>
              <button type="button" className="btn btn-sm" onClick={() => setStep('entry')}>
                ← Filters
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={!canExport}
                onClick={() => void runExport(exportDispatchChallanChecklistPdf)}
              >
                PDF
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canExport}
                onClick={() => {
                  try {
                    downloadDispatchChallanChecklistExcel(exportCtx);
                  } catch (err) {
                    setExportErr(err?.message || String(err));
                  }
                }}
              >
                Excel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-whatsapp"
                disabled={!canExport}
                onClick={() => void runExport(shareDispatchChallanChecklistWhatsApp)}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canExport}
                onClick={() => void runExport(printDispatchChallanChecklist)}
              >
                Print
              </button>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Quit
              </button>
            </div>
            {exportErr ? (
              <p className="deploy-update-msg deploy-update-msg--err" style={{ margin: '4px 12px' }}>
                {exportErr}
              </p>
            ) : null}
            <div style={{ overflow: 'auto', maxHeight: '65vh', padding: '0 10px 12px' }}>
              <p style={{ fontSize: 12, margin: '4px 0 8px', color: '#475569' }}>
                {rows.length} row(s) · {toDisplayDate(filters.sdt)} → {toDisplayDate(filters.edt)}
              </p>
              <table className="voucher-entry-form__grid" style={{ width: '100%', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ch.No</th>
                    <th>Party</th>
                    <th>City</th>
                    <th>Broker</th>
                    <th>Supplier</th>
                    <th>Item</th>
                    <th>Lot</th>
                    <th>BKH</th>
                    <th>God</th>
                    <th>Bags</th>
                    <th>Katta</th>
                    <th>HKat</th>
                    <th>Pkg</th>
                    <th>Weight</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const st = String(r.status || 'B').toUpperCase();
                    const q = num(r.qnty);
                    const bags = num(r.bags) || (st === 'B' ? q : 0);
                    const katta = num(r.katta) || (st === 'K' ? q : 0);
                    const hkatta = num(r.hkatta) || (st === 'H' ? q : 0);
                    return (
                      <tr
                        key={`${r.bill_no}-${r.trn_no}-${i}`}
                        className={i === highlight ? 'is-active' : ''}
                        onMouseEnter={() => setHighlight(i)}
                        onDoubleClick={() => {
                          if (r.bill_no && onSelect) onSelect({ bill_no: r.bill_no, b_type: r.b_type });
                        }}
                        style={{ cursor: onSelect ? 'pointer' : 'default' }}
                      >
                        <td>{r.bill_date}</td>
                        <td className="voucher-entry-form__num">
                          {r.bill_no}
                          {r.b_type}
                        </td>
                        <td>{r.party_name}</td>
                        <td>{r.city}</td>
                        <td>{r.bk_name}</td>
                        <td>{r.sup_name || r.sup_code}</td>
                        <td>{r.item_name}</td>
                        <td>{r.lot}</td>
                        <td>{r.status}</td>
                        <td>{r.god_code}</td>
                        <td className="voucher-entry-form__num">{bags || ''}</td>
                        <td className="voucher-entry-form__num">{katta || ''}</td>
                        <td className="voucher-entry-form__num">{hkatta || ''}</td>
                        <td className="voucher-entry-form__num">{r.packing || ''}</td>
                        <td className="voucher-entry-form__num">{fmtAmt(r.weight, 3)}</td>
                        <td className="voucher-entry-form__num">{fmtAmt(r.rate)}</td>
                        <td className="voucher-entry-form__num">{fmtAmt(r.amount)}</td>
                      </tr>
                    );
                  })}
                  {!rows.length ? (
                    <tr>
                      <td colSpan={17}>No rows.</td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={10} style={{ fontWeight: 700, textAlign: 'right' }}>
                      TOTAL
                    </td>
                    <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                      {totals.bags || ''}
                    </td>
                    <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                      {totals.katta || ''}
                    </td>
                    <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                      {totals.hkatta || ''}
                    </td>
                    <td />
                    <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                      {fmtAmt(totals.weight, 3)}
                    </td>
                    <td />
                    <td className="voucher-entry-form__num" style={{ fontWeight: 700 }}>
                      {fmtAmt(totals.amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <VoucherAccountHelpModal
          open={Boolean(helpField)}
          title={helpTitle}
          accounts={helpAccounts}
          onSelect={(code) => pickAccount(helpField, code)}
          onClose={() => setHelpField(null)}
        />
        <VoucherItemHelpModal
          open={itemHelpOpen}
          title="Item help"
          items={items}
          onSelect={(row) => {
            setFilters((f) => ({
              ...f,
              item_code: String(row?.item_code ?? row?.ITEM_CODE ?? '').trim(),
              item_name: String(row?.item_name ?? row?.ITEM_NAME ?? '').trim(),
            }));
            setItemHelpOpen(false);
          }}
          onClose={() => setItemHelpOpen(false)}
        />
        <VoucherGridHelpModal
          open={cityHelpOpen}
          title="City help"
          hint="Cities from MASTER · Enter picks"
          columns={CITY_HELP_COLUMNS}
          rows={cities}
          searchPlaceholder="Search city…"
          onSelect={(row) => {
            setFilters((f) => ({ ...f, city: String(row?.city ?? '').trim().toUpperCase() }));
            setCityHelpOpen(false);
          }}
          onClose={() => setCityHelpOpen(false)}
        />
      </div>
    </div>
  );
}
