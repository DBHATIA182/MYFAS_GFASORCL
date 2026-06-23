/**
 * Income tax report UI definitions — filters and display metadata per report id.
 * SQL/logic lives in server/incomeTaxReports.cjs (VFP prg/itaxrpt.prg + related).
 */

/** @typedef {'sdt'|'edt'|'minAmt'|'scheduleNo'|'stateCode'|'scode'|'icode'|'bkCode'|'bkName'|'godCode'|'mcode'|'mdc'|'mru'|'bNo'|'panYn'|'spNo'} IncomeTaxFilterKey */

const PARTY_ADDRESS_SUBKEYS = ['ADD1', 'ADD2', 'ADD3', 'CITY'];

function partyNameColumn(...extraSubKeys) {
  return {
    key: 'NAME',
    label: 'Name',
    type: 'partyBlock',
    subKeys: [...PARTY_ADDRESS_SUBKEYS, ...extraSubKeys],
  };
}

export const FISCAL_MONTH_COLS = [
  { key: 'APR', label: 'Apr', type: 'num' },
  { key: 'MAY', label: 'May', type: 'num' },
  { key: 'JUNE', label: 'June', type: 'num' },
  { key: 'JULY', label: 'July', type: 'num' },
  { key: 'AUGUST', label: 'Aug', type: 'num' },
  { key: 'SEP', label: 'Sep', type: 'num' },
  { key: 'OCTOBER', label: 'Oct', type: 'num' },
  { key: 'NOV', label: 'Nov', type: 'num' },
  { key: 'DEC', label: 'Dec', type: 'num' },
  { key: 'JAN', label: 'Jan', type: 'num' },
  { key: 'FEB', label: 'Feb', type: 'num' },
  { key: 'MAR', label: 'Mar', type: 'num' },
];

export const FISCAL_MONTH_KEYS = new Set(FISCAL_MONTH_COLS.map((c) => c.key));

/** @type {Record<string, { filters: IncomeTaxFilterKey[], pdfLandscape?: boolean, ledgerDrilldown?: boolean, compactTable?: boolean, displayColumns?: object[] }>} */
export const INCOME_TAX_REPORT_DEFS = {
  'loaner-list': { filters: ['sdt', 'edt', 'scheduleNo'] },
  'broker-list': { filters: ['sdt', 'edt', 'scheduleNo'] },
  'party-wise-purchase': {
    filters: ['sdt', 'edt', 'minAmt'],
    ledgerDrilldown: true,
    compactTable: true,
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn('OWN_NAME1'),
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'GST_NO', label: 'Gst No', type: 'text' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
      { key: 'TDS_AMOUNT', label: 'Tds Amount', type: 'num' },
    ],
  },
  'party-wise-sales': {
    filters: ['sdt', 'edt', 'minAmt', 'stateCode'],
    ledgerDrilldown: true,
    compactTable: true,
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn('STATE'),
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'GST_NO', label: 'Gst No', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
      { key: 'TDS_AMOUNT', label: 'Tds Amount', type: 'num' },
    ],
  },
  'month-schedule-wise-list': {
    filters: ['sdt', 'edt', 'minAmt', 'scheduleNo', 'mdc'],
    ledgerDrilldown: true,
    compactTable: true,
    monthPivot: true,
    groupBy: ['SCHEDULE', 'SCH_NAME'],
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'OP', label: 'Op', type: 'num' },
      ...FISCAL_MONTH_COLS,
      { key: 'TOT', label: 'Tot', type: 'num' },
    ],
  },
  'customer-arhat': { filters: ['sdt', 'edt', 'scode'] },
  'dami-wise-sales': { filters: ['sdt', 'edt'] },
  'monthly-purchase-report': { filters: ['sdt', 'edt', 'scheduleNo'] },
  'monthly-sales-report': { filters: ['sdt', 'edt'] },
  'item-wise-purchase-sale': { filters: ['sdt', 'edt'] },
  'item-wise-sales-dami': { filters: ['sdt', 'edt', 'stateCode'] },
  'party-wise-purchase-bill': { filters: ['sdt', 'edt'], ledgerDrilldown: true },
  'party-wise-sale-bill': { filters: ['sdt', 'edt', 'scheduleNo'], ledgerDrilldown: true },
  'party-wise-purchase-item': { filters: ['sdt', 'edt'], ledgerDrilldown: true },
  'party-wise-sale-item': { filters: ['sdt', 'edt', 'scode', 'stateCode'], ledgerDrilldown: true },
  'item-wise-sales-party': { filters: ['sdt', 'edt', 'stateCode', 'icode'] },
  'party-wise-sale-month': { filters: ['sdt', 'edt', 'bkCode', 'bkName', 'stateCode'] },
  'item-wise-sale-month-party': { filters: ['sdt', 'edt', 'bkCode', 'bkName', 'icode'] },
  'supplier-sales-customer-wise': { filters: ['sdt', 'edt', 'scode', 'icode', 'godCode', 'minAmt'] },
  'lot-wise-purchase-sale': { filters: ['sdt', 'edt', 'scode', 'icode', 'bNo', 'scheduleNo'] },
  'item-wise-purchase': { filters: ['sdt', 'edt'] },
  'item-wise-purchase-monthly': { filters: ['sdt', 'edt', 'bkCode', 'bkName', 'icode'] },
  'party-wise-sale-tdg-consg': { filters: ['sdt', 'edt'] },
  'sale-above-amount': { filters: ['sdt', 'edt', 'minAmt'] },
  'sale-detail-excel': { filters: ['sdt', 'edt'] },
  'item-wise-sales-detail': { filters: ['sdt', 'edt'] },
  'ledger-dccode-report': { filters: ['sdt', 'edt', 'scode', 'mdc', 'mru', 'scheduleNo'] },
  'purchase-detail-excel': { filters: ['sdt', 'edt'] },
  'cash-movement-monthly': { filters: ['sdt', 'edt', 'mcode', 'panYn', 'spNo'] },
  'monthly-cash-noncash-exp': { filters: ['sdt', 'edt'] },
  'customer-bill-payment-detail': { filters: ['sdt', 'edt'] },
  'customer-bill-payment-summary': { filters: ['sdt', 'edt'] },
  'broker-station-wise-sales': { filters: ['sdt', 'edt'] },
  'supplier-bill-payment-detail': { filters: ['sdt', 'edt'] },
};

export const INCOME_TAX_FILTER_LABELS = {
  sdt: 'Starting Date',
  edt: 'Ending Date',
  minAmt: 'Minimum Amount',
  scheduleNo: 'Specific Schedule',
  stateCode: 'State Code',
  scode: 'Party / Supplier Code',
  icode: 'Item Code',
  bkCode: 'Broker Code',
  bkName: 'Broker Name',
  godCode: 'Godown Code',
  mcode: 'Cash / A/c Code',
  mdc: 'Debit/Credit (D/C)',
  mru: 'GST Filter (R=with / U=without)',
  bNo: 'Bill No',
  panYn: 'PAN Type',
  spNo: 'Schedule Filter',
};

export function getIncomeTaxReportDef(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return INCOME_TAX_REPORT_DEFS[id] || { filters: ['sdt', 'edt'] };
}

export function humanizeColumnKey(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferColumnsFromRowKeys(row) {
  const keys = Object.keys(row).filter((k) => !k.startsWith('_'));
  return keys.map((key) => ({
    key,
    label: humanizeColumnKey(key),
    type: /amt|amount|bal|weight|wgt|qty|qnty|rate|tot|op|dr|cr|tds|int|sale|pur|exp|comm|brok|pap|dane|net/i.test(key) ? 'num' : 'text',
  }));
}

/** @param {string} reportId @param {object[]} apiColumns @param {object[]} rows */
export function resolveIncomeTaxDisplayColumns(reportId, apiColumns, rows) {
  const def = getIncomeTaxReportDef(reportId);
  if (def.displayColumns?.length) return def.displayColumns;
  if (apiColumns?.length) return apiColumns;
  if (rows?.length) return inferColumnsFromRowKeys(rows[0]);
  return [];
}

export function formatPartyBlockParts(row, col) {
  const name = String(row[col.key] ?? row[col.key?.toLowerCase?.()] ?? '').trim();
  const subs = (col.subKeys || [])
    .map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '').trim())
    .filter(Boolean);
  return { name, subs };
}

export function partyBlockExportText(row, col) {
  const { name, subs } = formatPartyBlockParts(row, col);
  return [name, ...subs].filter(Boolean).join('\n');
}

export function compactTableColClass(col) {
  if (col.key === 'CODE') return 'itax-col-code';
  if (col.type === 'partyBlock' || col.key === 'NAME') return 'itax-col-name';
  if (col.key === 'PAN') return 'itax-col-pan';
  if (col.key === 'GST_NO') return 'itax-col-gst';
  if (col.key === 'QNTY' || col.key === 'WEIGHT') return 'itax-col-qty';
  if (FISCAL_MONTH_KEYS.has(col.key) || col.key === 'OP' || col.key === 'TOT') return 'itax-col-mth';
  if (col.type === 'num') return 'itax-col-amt';
  return 'itax-col-text';
}

export function formatScheduleGroupLabel(row) {
  const sch = String(row.SCHEDULE ?? row.schedule ?? '').trim();
  const name = String(row.SCH_NAME ?? row.sch_name ?? '').trim();
  if (sch && name) return `Schedule ${sch} — ${name}`;
  if (sch) return `Schedule ${sch}`;
  if (name) return name;
  return 'Schedule';
}

/** @param {object[]} rows @param {string[]} groupKeys */
export function buildGroupedDisplayRows(rows, groupKeys, labelFn = formatScheduleGroupLabel) {
  const out = [];
  let prevKey = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const gk = groupKeys.map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '')).join('\0');
    if (gk !== prevKey) {
      out.push({
        _type: 'group',
        _id: `grp-${gk}-${i}`,
        label: labelFn(row),
      });
      prevKey = gk;
    }
    out.push({ _type: 'data', ...row, _id: row._id ?? `row-${i}` });
  }
  return out;
}
