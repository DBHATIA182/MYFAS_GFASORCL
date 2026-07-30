import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import VoucherAccountHelpModal from './VoucherAccountHelpModal';
import VoucherDmyDateInput from './VoucherDmyDateInput';
import VoucherGridHelpModal from './VoucherGridHelpModal';
import VoucherItemHelpModal from './VoucherItemHelpModal';
import { toDisplayDate, toOracleDate } from '../utils/dateFormat';
import {
  downloadGoodsInwardChecklistExcel,
  exportGoodsInwardChecklistPdf,
  printGoodsInwardChecklist,
  shareGoodsInwardChecklistWhatsApp,
} from '../utils/goodsInwardChecklistReport';

const reqOpts = { withCredentials: true, timeout: 120000 };

const GODOWN_HELP_COLUMNS = [
  { key: 'god_code', label: 'Code' },
  { key: 'god_name', label: 'Name' },
];

function emptyFilters(fyMinYmd, fyMaxYmd) {
  return {
    sdt: fyMinYmd || '',
    edt: fyMaxYmd || '',
    sbno: '1',
    ebno: '999999',
    code: '',
    party_name: '',
    bk_code: '',
    bk_name: '',
    item_code: '',
    item_name: '',
    god_code: '',
    god_name: '',
    pending_only: 'N',
  };
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtAmt(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function GoodsInwardChecklistModal({
  open,
  apiBase,
  apiParams,
  fyMinYmd = '',
  fyMaxYmd = '',
  formData,
  userName,
  purAccounts = [],
  brokers = [],
  items = [],
  godowns = [],
  onSelect,
  onClose,
}) {
  const [step, setStep] = useState('entry');
  const [filters, setFilters] = useState(() => emptyFilters(fyMinYmd, fyMaxYmd));
  const [rows, setRows] = useState([]);
  const [headName, setHeadName] = useState('INWARD REGISTER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportErr, setExportErr] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [helpField, setHelpField] = useState(null);
  const [itemHelpOpen, setItemHelpOpen] = useState(false);
  const [godownHelpOpen, setGodownHelpOpen] = useState(false);

  const fromDateRef = useRef(null);
  const toDateRef = useRef(null);
  const sbnoRef = useRef(null);
  const ebnoRef = useRef(null);
  const codeRef = useRef(null);
  const bkRef = useRef(null);
  const itemRef = useRef(null);
  const godRef = useRef(null);

  const godownRows = useMemo(
    () =>
      (godowns || []).map((g) => ({
        _id: String(g.GOD_CODE ?? g.god_code ?? ''),
        god_code: String(g.GOD_CODE ?? g.god_code ?? '').trim(),
        god_name: String(g.GOD_NAME ?? g.god_name ?? '').trim(),
      })),
    [godowns]
  );

  const totals = useMemo(() => {
    let qnty = 0;
    let weight = 0;
    let amount = 0;
    for (const row of rows) {
      qnty += num(row.qnty);
      weight += num(row.weight);
      amount += num(row.amount);
    }
    return { qnty, weight, amount };
  }, [rows]);

  const reportPeriod = useMemo(() => {
    const from = toDisplayDate(filters.sdt) || '…';
    const to = toDisplayDate(filters.edt) || '…';
    return `FROM ${from} TO ${to}`;
  }, [filters.sdt, filters.edt]);

  const resetAndOpen = () => {
    setStep('entry');
    setFilters(emptyFilters(fyMinYmd, fyMaxYmd));
    setRows([]);
    setHeadName('INWARD REGISTER');
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

  const runChecklist = async () => {
    if (!apiParams?.comp_code) return;
    setLoading(true);
    setError('');
    setExportErr('');
    try {
      const { data } = await axios.get(`${apiBase}/api/goods-inward/checklist`, {
        params: {
          ...apiParams,
          sdt: toOracleDate(filters.sdt),
          edt: toOracleDate(filters.edt),
          sbno: filters.sbno || 1,
          ebno: filters.ebno || 999999,
          code: filters.code || undefined,
          bk_code: filters.bk_code || undefined,
          item_code: filters.item_code || undefined,
          god_code: filters.god_code || undefined,
          pending_only: filters.pending_only === 'Y' ? 'P' : undefined,
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setHeadName(data?.head_name || 'INWARD REGISTER');
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

  const pickRow = (row) => {
    if (!row?.bill_no || !onSelect) return;
    onSelect({ bill_no: row.bill_no, bill_date: row.bill_date });
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

  const pickAccount = (field, code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const pool = field === 'bk_code' ? brokers : purAccounts;
    const row = pool.find((a) => String(a.CODE ?? a.code ?? '').trim().toUpperCase() === c);
    const name = String(row?.NAME ?? row?.name ?? '').trim();
    if (field === 'code') setFilters((f) => ({ ...f, code: c, party_name: name }));
    if (field === 'bk_code') setFilters((f) => ({ ...f, bk_code: c, bk_name: name }));
    setHelpField(null);
  };

  const pickItem = (row) => {
    setFilters((f) => ({
      ...f,
      item_code: String(row?.item_code ?? '').trim(),
      item_name: String(row?.item_name ?? '').trim(),
    }));
    setItemHelpOpen(false);
  };

  const pickGodown = (code) => {
    const c = String(code ?? '').trim().toUpperCase();
    const row = godowns.find((g) => String(g.GOD_CODE ?? g.god_code ?? '').trim().toUpperCase() === c);
    const name = String(row?.GOD_NAME ?? row?.god_name ?? '').trim();
    setFilters((f) => ({ ...f, god_code: c, god_name: name }));
    setGodownHelpOpen(false);
  };

  if (!open) return null;

  const isReport = step === 'report';

  return (
    <div className="voucher-help-modal" role="dialog" aria-modal="true" aria-label="Goods inward checklist">
      <button type="button" className="voucher-help-modal__backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`voucher-help-modal__panel voucher-help-modal__panel--account purchase-order-checklist-modal${
          isReport ? ' purchase-order-checklist-modal--report' : ''
        }`}
      >
        <header className="voucher-help-modal__head purchase-order-checklist-modal__head">
          <h3 className="voucher-help-modal__title">
            {isReport ? `${headName} — Report` : 'Goods Inward CheckList'}
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
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(sbnoRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field">
                <span>Starting No.</span>
                <input
                  ref={sbnoRef}
                  type="text"
                  className="form-input"
                  value={filters.sbno}
                  onChange={(e) => setFilters((f) => ({ ...f, sbno: e.target.value.replace(/\D/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(ebnoRef)}
                />
              </label>
              <label className="purchase-order-checklist-modal__field">
                <span>Ending No.</span>
                <input
                  ref={ebnoRef}
                  type="text"
                  className="form-input"
                  value={filters.ebno}
                  onChange={(e) => setFilters((f) => ({ ...f, ebno: e.target.value.replace(/\D/g, '') }))}
                  onKeyDown={(e) => e.key === 'Enter' && moveFocus(codeRef)}
                />
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Party Code</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={codeRef}
                    type="text"
                    className="form-input"
                    value={filters.code}
                    onChange={(e) => setFilters((f) => ({ ...f, code: e.target.value.toUpperCase(), party_name: '' }))}
                    onBlur={() => pickAccount('code', filters.code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('code');
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(bkRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setHelpField('code')}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.party_name} readOnly tabIndex={-1} />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--wide">
                <span>Broker</span>
                <div className="voucher-entry-form__code-help">
                  <input
                    ref={bkRef}
                    type="text"
                    className="form-input"
                    value={filters.bk_code}
                    onChange={(e) => setFilters((f) => ({ ...f, bk_code: e.target.value.toUpperCase(), bk_name: '' }))}
                    onBlur={() => pickAccount('bk_code', filters.bk_code)}
                    onKeyDown={(e) => {
                      if (e.key === 'F1') {
                        e.preventDefault();
                        setHelpField('bk_code');
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(itemRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setHelpField('bk_code')}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.bk_name} readOnly tabIndex={-1} />
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
                        setItemHelpOpen(true);
                        return;
                      }
                      if (e.key === 'Enter') moveFocus(godRef);
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setItemHelpOpen(true)}>
                    ?
                  </button>
                  <input type="text" className="form-input" value={filters.item_name} readOnly tabIndex={-1} />
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--half">
                <span>Godown</span>
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
                        setGodownHelpOpen(true);
                        return;
                      }
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void runChecklist();
                      }
                    }}
                  />
                  <button type="button" className="btn btn-xs" onClick={() => setGodownHelpOpen(true)}>
                    ?
                  </button>
                </div>
              </label>

              <label className="purchase-order-checklist-modal__field purchase-order-checklist-modal__field--half">
                <span>Pending Only (Y/N)</span>
                <select
                  className="form-input"
                  value={filters.pending_only}
                  onChange={(e) => setFilters((f) => ({ ...f, pending_only: e.target.value }))}
                >
                  <option value="N">N</option>
                  <option value="Y">Y</option>
                </select>
              </label>
            </div>

            <div className="purchase-order-checklist-modal__actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void runChecklist()} disabled={loading}>
                {loading ? 'Loading…' : 'Proceed'}
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
                <button type="button" className="btn btn-sm" disabled={!canExport} onClick={() => void runExport(exportGoodsInwardChecklistPdf)}>
                  PDF
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!canExport}
                  onClick={() => {
                    try {
                      downloadGoodsInwardChecklistExcel(rows, formData);
                    } catch (err) {
                      setExportErr(err?.message || String(err));
                    }
                  }}
                >
                  Excel
                </button>
                <button type="button" className="btn btn-sm" disabled={!canExport} onClick={() => void runExport(shareGoodsInwardChecklistWhatsApp)}>
                  WhatsApp
                </button>
                <button type="button" className="btn btn-sm" disabled={!canExport} onClick={() => void runExport(printGoodsInwardChecklist)}>
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
                <p className="voucher-help-modal__msg">No inward notes found for selected criteria.</p>
              ) : (
                <table className="voucher-help-modal__table voucher-help-modal__table--account purchase-order-checklist-modal__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>No.</th>
                      <th>SB</th>
                      <th>Party Name</th>
                      <th>Broker</th>
                      <th>Po.No.</th>
                      <th>Item Name</th>
                      <th className="voucher-help-modal__num">Qty.</th>
                      <th className="voucher-help-modal__num">Weight</th>
                      <th className="voucher-help-modal__num">Rate</th>
                      <th className="voucher-help-modal__num">Amount</th>
                      <th>God.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={`${row.bill_no}-${row.trn_no}-${idx}`}
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
                        <td>{toDisplayDate(row.bill_date) || row.bill_date}</td>
                        <td>{row.bill_no}</td>
                        <td>{row.sb_no || ''}</td>
                        <td>{row.party_name}</td>
                        <td>{row.bk_name}</td>
                        <td>{row.po_no || ''}</td>
                        <td>{row.item_name}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.qnty, 0)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.weight, 3)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.rate)}</td>
                        <td className="voucher-help-modal__num">{fmtAmt(row.amount)}</td>
                        <td>{row.god_code}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={7}>GRAND TOTAL</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.qnty, 0)}</th>
                      <th className="voucher-help-modal__num">{fmtAmt(totals.weight, 3)}</th>
                      <th />
                      <th className="voucher-help-modal__num">{fmtAmt(totals.amount)}</th>
                      <th />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <footer className="voucher-help-modal__foot">
              <span>{rows.length} record(s)</span>
              {onSelect ? <span>Click a row to open inward note</span> : null}
            </footer>
          </>
        )}
      </div>

      <VoucherAccountHelpModal
        open={Boolean(helpField)}
        title={helpField === 'bk_code' ? 'Broker help' : 'Party help'}
        accounts={helpField === 'bk_code' ? brokers : purAccounts}
        onSelect={(code) => pickAccount(helpField, code)}
        onClose={() => setHelpField(null)}
      />
      <VoucherItemHelpModal open={itemHelpOpen} title="Item help" items={items} onSelect={pickItem} onClose={() => setItemHelpOpen(false)} />
      <VoucherGridHelpModal
        open={godownHelpOpen}
        title="Godown help"
        columns={GODOWN_HELP_COLUMNS}
        rows={godownRows}
        onSelect={(row) => pickGodown(row.god_code)}
        onClose={() => setGodownHelpOpen(false)}
      />
    </div>
  );
}
