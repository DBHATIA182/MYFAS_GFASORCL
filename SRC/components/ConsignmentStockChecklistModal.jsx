import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import { toDisplayDate, toOracleDate } from '../utils/dateFormat';
import { apiUrl } from '../utils/resolveApiBase';
import {
  downloadConsignmentStockChecklistExcel,
  exportConsignmentStockChecklistPdf,
  printConsignmentStockChecklist,
  shareConsignmentStockChecklistWhatsApp,
} from '../utils/consignmentStockChecklistReport';

const reqOpts = { withCredentials: true, timeout: 120000 };

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];

function emptyFilters(fyMinYmd, fyMaxYmd) {
  return {
    sdt: fyMinYmd || '',
    edt: fyMaxYmd || '',
    code: '',
    party_name: '',
    msup_code: '',
    msup_name: '',
    item_code: '',
    item_name: '',
    god_code: '',
    god_name: '',
    mode: 'C',
  };
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtBno(row) {
  const type = String(row.type || '').trim().toUpperCase();
  const bNo = Number(row.b_no) || 0;
  if (!bNo && !type) return '';
  return type ? `${type} ${bNo}` : String(bNo);
}

function supplierName(pool, code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return '';
  const row = (pool || []).find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
  return String(row?.NAME ?? row?.name ?? '').trim();
}

export default function ConsignmentStockChecklistModal({
  open,
  apiBase,
  apiParams,
  fyMinYmd = '',
  fyMaxYmd = '',
  formData,
  userName,
  suppliers = [],
  items = [],
  godowns = [],
  onSelect,
  onClose,
}) {
  const [step, setStep] = useState('entry');
  const [filters, setFilters] = useState(() => emptyFilters(fyMinYmd, fyMaxYmd));
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ bags: 0, katta: 0, hkatta: 0, weight: 0, amount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [helpField, setHelpField] = useState(null);
  const [itemHelpOpen, setItemHelpOpen] = useState(false);
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);

  const fromDateRef = useRef(null);
  const toDateRef = useRef(null);
  const codeRef = useRef(null);
  const msupRef = useRef(null);
  const itemRef = useRef(null);
  const godRef = useRef(null);
  const modeRef = useRef(null);
  const helpReturnFocusRef = useRef(null);

  const godownRows = useMemo(
    () =>
      (godowns || []).map((g) => ({
        _id: String(g.GOD_CODE ?? g.god_code ?? ''),
        god_code: String(g.GOD_CODE ?? g.god_code ?? '').trim(),
        god_name: String(g.GOD_NAME ?? g.god_name ?? '').trim(),
      })),
    [godowns]
  );

  const reportPeriod = useMemo(() => {
    const from = toDisplayDate(filters.sdt) || '…';
    const to = toDisplayDate(filters.edt) || '…';
    return `FROM ${from} TO ${to}`;
  }, [filters.sdt, filters.edt]);

  const resetAndOpen = () => {
    setStep('entry');
    setFilters(emptyFilters(fyMinYmd, fyMaxYmd));
    setRows([]);
    setTotals({ bags: 0, katta: 0, hkatta: 0, weight: 0, amount: 0 });
    setError('');
    setExportErr('');
    setHighlight(0);
    setHelpField(null);
    setItemHelpOpen(false);
    setGodownHelpOpen(false);
  };

  React.useEffect(() => {
    if (!open) return;
    resetAndOpen();
  }, [open, fyMinYmd, fyMaxYmd]);

  const moveFocus = (ref) => window.setTimeout(() => ref?.current?.focus(), 0);

  const restoreHelpFocus = () => {
    const el = helpReturnFocusRef.current;
    helpReturnFocusRef.current = null;
    if (el) window.setTimeout(() => el.focus?.(), 0);
  };

  const openFieldHelp = (field, ref) => {
    helpReturnFocusRef.current = ref?.current || null;
    setHelpField(field);
  };

  const openItemHelp = () => {
    helpReturnFocusRef.current = itemRef.current;
    setItemHelpOpen(true);
  };

  const openGodownHelp = () => {
    helpReturnFocusRef.current = godRef.current;
    setGodownHelpOpen(true);
  };

  const fetchChecklist = async () => {
    if (!apiParams?.comp_code) return { rows: [], totals: null };
    const { data } = await axios.get(apiUrl(apiBase, '/api/consignment-stock/checklist'), {
      params: {
        ...apiParams,
        sdt: toOracleDate(filters.sdt),
        edt: toOracleDate(filters.edt),
        code: filters.code || undefined,
        msup_code: filters.msup_code || undefined,
        item_code: filters.item_code || undefined,
        god_code: filters.god_code || undefined,
        mode: filters.mode || 'C',
      },
      ...reqOpts,
    });
    return {
      rows: Array.isArray(data?.rows) ? data.rows : [],
      totals: data?.totals || null,
    };
  };

  const runChecklist = async () => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      const result = await fetchChecklist();
      setRows(result.rows);
      setTotals(
        result.totals || {
          bags: result.rows.reduce((s, r) => s + num(r.bags), 0),
          katta: result.rows.reduce((s, r) => s + num(r.katta), 0),
          hkatta: result.rows.reduce((s, r) => s + num(r.hkatta), 0),
          weight: result.rows.reduce((s, r) => s + num(r.weight), 0),
          amount: result.rows.reduce((s, r) => s + num(r.amount), 0),
        }
      );
      setHighlight(0);
      setStep('report');
    } catch (err) {
      setRows([]);
      setError(err.response?.data?.error || err.message || 'Checklist failed.');
    } finally {
      setLoading(false);
    }
  };

  const runExcelFromEntry = async () => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      const result = await fetchChecklist();
      if (!result.rows.length) {
        setError('No records found for selected criteria.');
        return;
      }
      downloadConsignmentStockChecklistExcel(result.rows, formData);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Excel export failed.');
    } finally {
      setLoading(false);
    }
  };

  const exportCtx = useMemo(
    () => ({
      rows,
      filters,
      totals,
      formData,
      userName,
      compCode: apiParams?.comp_code,
      compUid: apiParams?.comp_uid,
    }),
    [apiParams, filters, formData, rows, totals, userName]
  );

  const canExport = rows.length > 0;

  const pickRow = (row) => {
    if (!row?.r_no || !onSelect) return;
    onSelect({ r_no: row.r_no, r_date: row.r_date });
  };

  const runExport = async (fn) => {
    if (!canExport) return;
    setExportErr('');
    try {
      await fn(apiBase, exportCtx);
    } catch (err) {
      setExportErr(err?.message || String(err));
    }
  };

  const pickParty = (field, code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const name = supplierName(suppliers, c);
    if (field === 'msup_code') setFilters((f) => ({ ...f, msup_code: c, msup_name: name }));
    else setFilters((f) => ({ ...f, code: c, party_name: name }));
    setHelpField(null);
    restoreHelpFocus();
  };

  const pickItem = (row) => {
    setFilters((f) => ({
      ...f,
      item_code: String(row?.item_code ?? '').trim(),
      item_name: String(row?.item_name ?? '').trim(),
    }));
    setItemHelpOpen(false);
    restoreHelpFocus();
  };

  const pickGodown = (code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const row = godowns.find((g) => String(g.GOD_CODE ?? g.god_code ?? '').trim().toUpperCase() === c);
    const name = String(row?.GOD_NAME ?? row?.god_name ?? '').trim();
    setFilters((f) => ({ ...f, god_code: c, god_name: name }));
    setGodownHelpOpen(false);
    restoreHelpFocus();
  };

  if (!open) return null;

  const isReport = step === 'report';

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label="Consignment stock checklist">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`voucher-help-modal__panel voucher-help-modal__panel--account purchase-order-checklist-modal${
          isReport ? ' purchase-order-checklist-modal--report' : ''
        }`}
      >
        <header className="voucher-help-modal__head purchase-order-checklist-modal__head">
          <h3 className="voucher-help-modal__title">
            {isReport ? 'CONSIGNMENT STOCK LIST — Report' : 'CONSIGNMENT STOCK LIST'}
          </h3>
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
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(codeRef)}
                />
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Code</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={codeRef}
                    type="text"
                    className="form-input"
                    value={filters.code}
                    onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value.toUpperCase(), party_name: '' }))}
                    onBlur={() => pickParty('code', filters.code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        openFieldHelp('code', codeRef);
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(msupRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => openFieldHelp('code', codeRef)}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.party_name} readOnly tabIndex={-1} />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Main Supplier Code</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={msupRef}
                    type="text"
                    className="form-input"
                    value={filters.msup_code}
                    onChange={(e) => setFilters((f) => ({ ...f, msup_code: e.target.value.toUpperCase(), msup_name: '' }))}
                    onBlur={() => pickParty('msup_code', filters.msup_code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        openFieldHelp('msup_code', msupRef);
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(itemRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => openFieldHelp('msup_code', msupRef)}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.msup_name} readOnly tabIndex={-1} />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Item</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={itemRef}
                    type="text"
                    className="form-input"
                    value={filters.item_code}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, item_code: e.target.value.replace(/\D/g, ''), item_name: '' }))
                    }
                    onBlur={() => {
                      const row = items.find((it) => Number(it.ITEM_CODE ?? it.item_code) === Number(filters.item_code));
                      setFilters((f) => ({ ...f, item_name: String(row?.ITEM_NAME ?? row?.item_name ?? '').trim() }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        openItemHelp();
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(godRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={openItemHelp}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.item_name} readOnly tabIndex={-1} />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Specific Godown</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={godRef}
                    type="text"
                    className="form-input"
                    value={filters.god_code}
                    onChange={(e) => setFilters((f) => ({ ...f, god_code: e.target.value.toUpperCase(), god_name: '' }))}
                    onBlur={() => pickGodown(filters.god_code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        openGodownHelp();
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(modeRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={openGodownHelp}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.god_name} readOnly tabIndex={-1} />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>(C)onsignment / (P)urchase / (B)oth</span>
                <input
                  ref={modeRef}
                  type="text"
                  className="form-input"
                  style={{ maxWidth: '4rem' }}
                  value={filters.mode}
                  maxLength={1}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().slice(0, 1);
                    if (!v || 'CPB'.includes(v)) setFilters((f) => ({ ...f, mode: v || 'C' }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runChecklist();
                    }
                  }}
                />
              </label>
            </div>

            <div className="purchase-order-checklist-modal__actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void runChecklist()} disabled={loading}>
                {loading ? 'Loading…' : 'Proceed'}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void runExcelFromEntry()} disabled={loading}>
                Excel
              </button>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Quit
              </button>
            </div>
            {error ? <p className="purchase-order-checklist-modal__error">{error}</p> : null}
          </div>
        ) : (
          <>
            <div className="purchase-order-checklist-modal__report-bar">
              <span className="purchase-order-checklist-modal__report-period">{reportPeriod}</span>
              <div className="purchase-order-checklist-modal__report-actions">
                <button type="button" className="btn btn-sm" disabled={!canExport} onClick={() => void runExport(exportConsignmentStockChecklistPdf)}>
                  PDF
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => {
                    try {
                      downloadConsignmentStockChecklistExcel(rows, formData);
                    } catch (err) {
                      setExportErr(err?.message || String(err));
                    }
                  }}
                >
                  Excel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => void runExport(shareConsignmentStockChecklistWhatsApp)}
                >
                  WhatsApp
                </button>
                <button type="button" className="btn btn-sm" disabled={!canExport} onClick={() => void runExport(printConsignmentStockChecklist)}>
                  Print
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setStep('entry')}>
                  Back
                </button>
                <button type="button" className="btn btn-sm" onClick={onClose}>
                  Quit
                </button>
              </div>
            </div>
            {exportErr ? <p className="purchase-order-checklist-modal__error">{exportErr}</p> : null}
            <div className="voucher-help-modal__body voucher-help-modal__body--account purchase-order-checklist-modal__body purchase-order-checklist-modal__body--report">
              {!rows.length ? (
                <p className="voucher-help-modal__msg">No consignment stock found for selected criteria.</p>
              ) : (
                <table className="voucher-help-modal__table voucher-help-modal__table--account purchase-order-checklist-modal__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sr.No.</th>
                      <th>B.No.</th>
                      <th>Item</th>
                      <th>Name</th>
                      <th>G</th>
                      <th>Lot</th>
                      <th>Party Name</th>
                      <th className="voucher-help-modal__num">Bags</th>
                      <th className="voucher-help-modal__num">Kata</th>
                      <th className="voucher-help-modal__num">Hkatta</th>
                      <th className="voucher-help-modal__num">Weight</th>
                      <th className="voucher-help-modal__num">Amount</th>
                      <th>Form</th>
                      <th>FB</th>
                      <th>L</th>
                      <th>CAT</th>
                      <th>Truck / GR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={`${row.type}-${row.r_no}-${idx}`}
                        className={`voucher-help-modal__row${idx === highlight ? ' is-active' : ''}`}
                        tabIndex={0}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => pickRow(row)}
                        onDoubleClick={() => pickRow(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            pickRow(row);
                          }
                        }}
                      >
                        <td>{toDisplayDate(row.r_date) || row.r_date}</td>
                        <td>{row.r_no}</td>
                        <td>{fmtBno(row)}</td>
                        <td>{row.item_code}</td>
                        <td>{row.item_name}</td>
                        <td>{row.god_code}</td>
                        <td>{row.lot || ''}</td>
                        <td>{row.party_name}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.bags, 0)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.katta, 0)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.hkatta, 0)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.weight, 3)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.amount)}</td>
                        <td>{row.f_form}</td>
                        <td>{row.labour}</td>
                        <td>{row.l_c}</td>
                        <td>{row.exp_cat}</td>
                        <td>
                          {[row.truck_no, row.gr_no].filter(Boolean).join(' / ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={8}>GRAND TOTAL</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.bags, 0)}</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.katta, 0)}</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.hkatta, 0)}</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.weight, 3)}</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.amount)}</th>
                      <th colSpan={5} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <footer className="voucher-help-modal__foot">
              <span>{rows.length} record(s)</span>
              {onSelect ? <span>Click a row to open entry</span> : null}
            </footer>
          </>
        )}
      </div>

      <VoucherAccountHelpModal
        open={Boolean(helpField)}
        title={helpField === 'msup_code' ? 'Main supplier help' : 'Party help'}
        accounts={suppliers}
        onSelect={(code) => pickParty(helpField, code)}
        onClose={() => {
          setHelpField(null);
          restoreHelpFocus();
        }}
      />
      <VoucherItemHelpModal
        open={itemHelpOpen}
        title="Item help"
        items={items}
        unifiedSearch
        onSelect={pickItem}
        onClose={() => {
          setItemHelpOpen(false);
          restoreHelpFocus();
        }}
      />
      <VoucherGridHelpModal
        open={godownHelpOpen}
        title="Godown help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownRows}
        onSelect={(row) => pickGodown(row.god_code)}
        onClose={() => {
          setGodownHelpOpen(false);
          restoreHelpFocus();
        }}
      />
    </div>
  );
}
