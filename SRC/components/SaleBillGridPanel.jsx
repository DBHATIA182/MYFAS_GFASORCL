import React from 'react';

const BKH_OPTIONS = ['B', 'K', 'H'];

/** Normalize SALEFORM_GST.F_NAME aliases used in live DBs. */
export function normalizeSaleGridFName(raw) {
  const n = String(raw ?? '').trim().toUpperCase();
  if (n === 'NDIS_PER') return 'DIS_PER';
  if (n === 'NDIS_AMT') return 'DIS_AMT';
  return n;
}

/**
 * SALEFORM_GST grid map — S_NO order from VFP grdcol_o (GRID1.COLUMN{S_NO}).
 * Visibility: S_NO<>0 and HIDE_COL <> 'Y' (NVL → 'N' means show).
 */
export const SALE_GRID_COLUMNS = [
  { key: 'so_no', colName: 'SO_NO', label: 'SoNo', sNo: 2 },
  { key: 'ch_no', colName: 'CH_NO', label: 'ChNo', sNo: 3 },
  { key: 'item_code', colName: 'ITEM_CODE', label: 'Itemcode', sNo: 4, always: true },
  { key: 'lot', colName: 'LOT', label: 'Lot', sNo: 5 },
  { key: 'status', colName: 'STATUS', label: 'B/K/H', sNo: 6 },
  { key: 'b_no', colName: 'B_NO', label: 'B.No', sNo: 7 },
  { key: 'god_code', colName: 'GOD_CODE', label: 'GodCode', sNo: 8 },
  { key: 'sup_code', colName: 'SUP_CODE', label: 'SupCode', sNo: 9 },
  { key: 'marka', colName: 'MARKA', label: 'Marka', sNo: 10 },
  { key: 'qnty', colName: 'QNTY', label: 'Qty.', sNo: 11, always: true },
  { key: 'packing', colName: 'PACKING', label: 'Packing', sNo: 12 },
  { key: 'g_weight', colName: 'G_WEIGHT', label: 'Gweight', sNo: 13 },
  { key: 'd_weight', colName: 'D_WEIGHT', label: 'D.Weight', sNo: 14 },
  { key: 'weight', colName: 'WEIGHT', label: 'Weight', sNo: 15, always: true },
  { key: 's_rate', colName: 'S_RATE', label: 'S.Rate', sNo: 16 },
  { key: 'rate', colName: 'RATE', label: 'Rate', sNo: 17, always: true },
  { key: 'amount', colName: 'AMOUNT', label: 'Amount', sNo: 18, always: true },
  { key: 'comm_per', colName: 'COMM_PER', label: 'Comm%', sNo: 19 },
  { key: 'brok_per', colName: 'BROK_PER', label: 'Brok%', sNo: 20 },
  { key: 'dane', colName: 'DANE', label: 'Dane', sNo: 21 },
  { key: 'dane_wgt', colName: 'DANE_WGT', label: 'DaneWgt', sNo: 22 },
  { key: 'item_name', colName: 'ITEM_NAME', label: 'ItemName', sNo: 23, always: true, readOnly: true },
  { key: 'sname', colName: 'SNAME', label: 'S.Name', sNo: 24, readOnly: true },
  { key: 'item_cat', colName: 'ITEM_CAT', label: 'ItemCat', sNo: 25 },
  { key: 'paploo1', colName: 'PAPLOO1', label: 'Paploo1', sNo: 26 },
  { key: 'paploo2', colName: 'PAPLOO2', label: 'Paploo2', sNo: 27 },
  { key: 'paploo5', colName: 'PAPLOO5', label: 'Paploo5', sNo: 28 },
  { key: 'paploo3', colName: 'PAPLOO3', label: 'Paploo3', sNo: 29 },
  { key: 'p_amt1', colName: 'P_AMT1', label: 'P.Amt1', sNo: 30 },
  { key: 'p_amt2', colName: 'P_AMT2', label: 'P.Amt2', sNo: 31 },
  { key: 'p_amt3', colName: 'P_AMT3', label: 'P.Amt3', sNo: 32 },
  { key: 'p_amt5', colName: 'P_AMT5', label: 'P.Amt5', sNo: 33 },
  { key: 'e_d', colName: 'E_D', label: 'E/D', sNo: 34 },
  { key: 'e_damt', colName: 'E_DAMT', label: 'E.DAmt', sNo: 35 },
  { key: 'paploo4', colName: 'PAPLOO4', label: 'Paploo4', sNo: 36 },
  { key: 'p_amt4', colName: 'P_AMT4', label: 'P.Amt4', sNo: 37 },
  { key: 's_exp1', colName: 'S_EXP1', label: 'S.Exp1', sNo: 42 },
  { key: 's_exp2', colName: 'S_EXP2', label: 'S.Exp2', sNo: 43 },
  { key: 's_exp3', colName: 'S_EXP3', label: 'S.Exp3', sNo: 44 },
  { key: 'cost_code', colName: 'COST_CODE', label: 'CostCode', sNo: 48 },
  { key: 'sup_date', colName: 'SUP_DATE', label: 'SupDate', sNo: 49 },
  { key: 'dis_per', colName: 'DIS_PER', label: 'Dis%', sNo: 50 },
  { key: 'dis_amt', colName: 'DIS_AMT', label: 'DisAmt', sNo: 51 },
  { key: 'cgst_per', colName: 'CGST_PER', label: 'Cgst%', sNo: 52 },
  { key: 'cgst_amt', colName: 'CGST_AMT', label: 'CgstAmt', sNo: 52.1, companionOf: 'CGST_PER' },
  { key: 'sgst_per', colName: 'SGST_PER', label: 'Sgst%', sNo: 53 },
  { key: 'sgst_amt', colName: 'SGST_AMT', label: 'SgstAmt', sNo: 53.1, companionOf: 'SGST_PER' },
  { key: 'igst_per', colName: 'IGST_PER', label: 'Igst%', sNo: 54 },
  { key: 'igst_amt', colName: 'IGST_AMT', label: 'IgstAmt', sNo: 54.1, companionOf: 'IGST_PER' },
  { key: 'bard_item_code', colName: 'BARD_ITEM_CODE', label: 'BardItem', sNo: 55 },
];

const COL_BY_NAME = new Map(SALE_GRID_COLUMNS.map((c) => [c.colName, c]));

/** Fallback when SALEFORM_GST has no S_NO<>0 rows. */
const DEFAULT_VISIBLE = SALE_GRID_COLUMNS.filter(
  (c) =>
    c.always ||
    ['LOT', 'STATUS', 'B_NO', 'GOD_CODE', 'SUP_CODE', 'PACKING', 'G_WEIGHT', 'D_WEIGHT', 'S_RATE', 'COMM_PER', 'BROK_PER', 'SNAME', 'DIS_PER', 'DIS_AMT', 'CGST_PER', 'CGST_AMT', 'SGST_PER', 'SGST_AMT', 'IGST_PER', 'IGST_AMT'].includes(
      c.colName
    )
);

/**
 * VFP grdcol_o: SELECT SALEFORM_GST WHERE S_NO<>0;
 * HIDE_COL='Y' → hide, else show. Order by S_NO.
 * @param {Array|{hidden?:Set}|Set} gridColumnsOrHidden — prefer grid_columns rows from context
 */
export function getVisibleSaleGridColumns(gridColumnsOrHidden) {
  // Legacy: Set of hidden col names
  if (gridColumnsOrHidden instanceof Set) {
    return SALE_GRID_COLUMNS.filter((c) => c.always || !gridColumnsOrHidden.has(c.colName));
  }
  if (gridColumnsOrHidden && gridColumnsOrHidden.hidden instanceof Set) {
    return SALE_GRID_COLUMNS.filter((c) => c.always || !gridColumnsOrHidden.hidden.has(c.colName));
  }

  const rows = Array.isArray(gridColumnsOrHidden) ? gridColumnsOrHidden : [];
  const cfg = [];
  for (const r of rows) {
    const sNo = Number(r.S_NO ?? r.s_no ?? 0) || 0;
    if (sNo <= 0) continue;
    const fName = normalizeSaleGridFName(r.F_NAME ?? r.f_name ?? r.COL_NAME ?? r.col_name);
    if (!fName) continue;
    const hide = String(r.HIDE_COL ?? r.hide_col ?? 'N').trim().toUpperCase() === 'Y';
    cfg.push({ fName, sNo, hide });
  }

  if (!cfg.length) return DEFAULT_VISIBLE;

  cfg.sort((a, b) => a.sNo - b.sNo || a.fName.localeCompare(b.fName));

  const visible = [];
  const seen = new Set();
  const shownNames = new Set();

  const pushCol = (col) => {
    if (!col || seen.has(col.key)) return;
    visible.push(col);
    seen.add(col.key);
    shownNames.add(col.colName);
  };

  for (const { fName, hide } of cfg) {
    if (hide) continue;
    pushCol(COL_BY_NAME.get(fName));
  }

  // GST amount companions (not always separate SALEFORM rows)
  for (const col of SALE_GRID_COLUMNS) {
    if (!col.companionOf) continue;
    if (shownNames.has(col.companionOf)) pushCol(col);
  }

  // Read-only name columns when codes are visible
  if (shownNames.has('ITEM_CODE')) pushCol(COL_BY_NAME.get('ITEM_NAME'));
  if (shownNames.has('SUP_CODE')) pushCol(COL_BY_NAME.get('SNAME'));

  // Stable display order by sNo
  visible.sort((a, b) => (a.sNo ?? 99) - (b.sNo ?? 99));

  return visible.length ? visible : DEFAULT_VISIBLE;
}

function numInput(onChange) {
  return (e) => onChange(e.target.value.replace(/[^\d.-]/g, ''));
}

function HelpBtn({ onClick, disabled, title = 'Search help (F1)' }) {
  return (
    <button
      type="button"
      className="pb-help-btn"
      onClick={onClick}
      disabled={disabled}
      title={title}
      tabIndex={-1}
      aria-label={title}
    >
      ⌕
    </button>
  );
}

function GridCodeCell({ value, disabled, focusRef, onChange, onKeyDown, onBlur, onHelp, helpTitle, className = 'form-input' }) {
  return (
    <div className="pb-grid-cell-wrap">
      <input
        className={className}
        value={value ?? ''}
        disabled={disabled}
        ref={focusRef}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <HelpBtn onClick={onHelp} disabled={disabled} title={helpTitle} />
    </div>
  );
}

function LnCell({ className = 'form-input', value, disabled, readOnly, focusRef, onChange, onKeyDown, onBlur, maxLength }) {
  return (
    <input
      className={className}
      value={value ?? ''}
      disabled={disabled}
      readOnly={readOnly}
      ref={focusRef}
      maxLength={maxLength}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}

const HELP_KIND_BY_COL = {
  so_no: 'so',
  ch_no: 'ch',
  item_code: 'item',
  lot: 'lot',
  god_code: 'god',
  sup_code: 'sup',
  marka: 'marka',
  dane: 'dane',
};

const READONLY_KEYS = new Set(['item_name', 'sname']);

/** Renders one grid cell for a given column key — F1 kinds (item/lot/sup/god/so/ch) get a help button. */
function GridCell({ col, ln, editable, focusChain, updateLine, handleGridF1, openGridHelp }) {
  const key = col.key;
  const focusKey = `ln-${ln.key}-${key}`;
  const helpKind = HELP_KIND_BY_COL[key];

  if (READONLY_KEYS.has(key) || col.readOnly) {
    return <td className="pb-col-name">{ln[key]}</td>;
  }
  if (key === 'status') {
    return (
      <td>
        <select
          className="form-input"
          value={ln.status}
          disabled={!editable}
          ref={(el) => focusChain.register(focusKey, el)}
          onChange={(e) => updateLine(ln.key, { status: e.target.value })}
          onKeyDown={focusChain.onEnter(focusKey)}
        >
          {BKH_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </td>
    );
  }
  if (helpKind) {
    const numeric = key === 'so_no' || key === 'ch_no' || key === 'lot' || key === 'b_no';
    const isDane = key === 'dane';
    return (
      <td>
        <GridCodeCell
          value={ln[key]}
          disabled={!editable}
          focusRef={(el) => focusChain.register(focusKey, el)}
          onChange={(e) => {
            let v = e.target.value;
            if (isDane) v = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 1);
            else if (numeric) v = v.replace(/\D/g, '');
            else v = v.toUpperCase();
            updateLine(ln.key, { [key]: v });
          }}
          onKeyDown={(e) => {
            handleGridF1(e, helpKind, ln.key);
            if (!e.defaultPrevented) focusChain.onEnter(focusKey)(e);
          }}
          onHelp={() => openGridHelp(helpKind, ln.key)}
          helpTitle={isDane ? 'Dane Type (F1)' : `${col.label} help (F1)`}
        />
      </td>
    );
  }
  if (key === 'b_no' || key === 'cost_code' || key === 'bard_item_code' || key === 'sup_date' || key === 'item_cat') {
    return (
      <td>
        <LnCell
          value={ln[key]}
          disabled={!editable}
          focusRef={(el) => focusChain.register(focusKey, el)}
          onChange={(e) =>
            updateLine(ln.key, {
              [key]: key === 'item_cat' ? e.target.value : e.target.value.toUpperCase(),
            })
          }
          onKeyDown={focusChain.onEnter(focusKey)}
        />
      </td>
    );
  }
  // Numeric fields
  return (
    <td>
      <LnCell
        className={`form-input ${key === 'weight' || key === 'g_weight' || key === 'd_weight' || key === 'dane_wgt' ? 'pb-wgt-input' : key === 'rate' || key === 's_rate' ? 'pb-rate-input' : key === 'amount' || String(key).includes('amt') ? 'pb-amt-input' : 'pb-col-pct'}`}
        value={ln[key]}
        disabled={!editable}
        focusRef={(el) => focusChain.register(focusKey, el)}
        onChange={numInput((v) => updateLine(ln.key, { [key]: v }))}
        onKeyDown={(e) => {
          if (key === 'amount') handleGridF1(e, 'amt', ln.key);
          if (!e.defaultPrevented) focusChain.onEnter(focusKey)(e);
        }}
      />
    </td>
  );
}

/** Grid 1 — SALEFORM_GST line items, visible columns driven by HIDE_COL / S_NO<>0 (grdcol_o). */
export default function SaleBillGridPanel({
  lines,
  editable,
  busy,
  focusChain,
  updateLine,
  handleGridF1,
  openGridHelp,
  onAddLine,
  visibleColumns,
}) {
  const cols = visibleColumns && visibleColumns.length ? visibleColumns : DEFAULT_VISIBLE;

  return (
    <section className="pb-lines-section sb-lines-section">
      <p className="pb-lines-hint">
        Grid 1 — columns from SALEFORM_GST (S_NO≠0, Hide=N) · F1: Item / Lot / Marka / Dane / Sup / God / So / Ch
        {editable ? (
          <button type="button" className="btn btn-xs pb-add-line-btn" onClick={onAddLine} disabled={busy}>
            + Line
          </button>
        ) : null}
      </p>
      <div className="pb-lines-wrap table-responsive--sale-list">
        <table className="pb-lines-table pb-lines-table--grid1 pb-lines-table--full sb-lines-table">
          <thead>
            <tr>
              <th>Sno</th>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, idx) => (
              <tr key={ln.key}>
                <td className="pb-col-sno">{idx + 1}</td>
                {cols.map((c) => (
                  <GridCell
                    key={c.key}
                    col={c}
                    ln={ln}
                    editable={editable}
                    focusChain={focusChain}
                    updateLine={updateLine}
                    handleGridF1={handleGridF1}
                    openGridHelp={openGridHelp}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
