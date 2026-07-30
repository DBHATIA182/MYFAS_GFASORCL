/**
 * Voucher book report UI definitions — filters and columns per report id.
 * SQL/logic: server/voucherBooks.cjs (VFP BOOKS.PRG)
 */

import { humanizeColumnKey } from './incomeTaxReportDefs';

const numCol = (key, label, decimals = 2) => ({ key, label, type: 'num', decimals });
const txtCol = (key, label) => ({ key, label, type: 'text' });
const dateCol = (key, label) => ({ key, label, type: 'date' });

const BOOK_DETAIL_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_NO', 'No'),
  txtCol('VR_TYPE', 'Type'),
  txtCol('NAME', 'Party'),
  txtCol('CITY', 'City'),
  txtCol('DETAIL', 'Detail'),
  txtCol('CHQ_NO', 'Chq No'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
  numCol('RUN_BAL', 'Balance'),
];

const BOOK_SUMMARY_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_NO', 'No'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
];

const JOURNAL_DETAIL_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_NO', 'No'),
  txtCol('NAME', 'Account'),
  txtCol('CITY', 'City'),
  txtCol('DETAIL', 'Detail'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
];

const DAY_BOOK_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_NO', 'No'),
  txtCol('VR_TYPE', 'Type'),
  txtCol('NAME', 'Account'),
  txtCol('DETAIL', 'Detail'),
  txtCol('CHQ_NO', 'Chq No'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
];

const BANK_STMT_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_TYPE', 'Type'),
  txtCol('VR_NO', 'No'),
  txtCol('CHQ_NO', 'Chq No'),
  txtCol('DETAIL', 'Detail'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
  dateCol('BANK_DATE', 'Bank Date'),
  numCol('RUN_BAL', 'Balance'),
];

const BANK_RECON_COLS = [
  txtCol('VR_TYPE', 'Type'),
  dateCol('VR_DATE', 'Vr Date'),
  txtCol('VR_NO', 'No'),
  txtCol('CODE', 'Code'),
  txtCol('NAME', 'Party'),
  txtCol('CHQ_NO', 'Chq No'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
  dateCol('CL_DATE', 'Clear Date'),
  txtCol('DETAIL', 'Detail'),
];

const CASH_ACCOUNT_FILTER = {
  label: 'Cash A/c',
  required: true,
  pickList: 'masterAccount',
  schedules: '9.10',
  manualCode: true,
  hint: 'Cash account (schedule 9.10) — tap ? / F1 to search.',
};

const BANK_ACCOUNT_FILTER = {
  label: 'Bank A/c',
  required: true,
  pickList: 'masterAccount',
  schedules: '9.20',
  manualCode: true,
  hint: 'Bank account (schedule 9.20) — tap ? / F1 to search.',
};

const CASH_BOOK_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_NO', 'Vr.No.'),
  { key: 'NAME', label: 'Particulars', type: 'partyBlock', subKeys: ['DETAIL'] },
  txtCol('CITY', 'City'),
  dateCol('BILL_DATE', 'Bill Date'),
  txtCol('BILL_NO', 'Bill No'),
  numCol('DR_AMT', 'Receipts'),
  numCol('CR_AMT', 'Payments'),
];

/** @type {Record<string, object>} */
export const VOUCHER_BOOK_REPORT_DEFS = {
  'cash-book': {
    filters: ['sdt', 'edt', 'mcode'],
    bookDayWiseFormat: true,
    compactEntry: true,
    compactTable: true,
    voucherEntryDrill: true,
    filterOverrides: { mcode: CASH_ACCOUNT_FILTER },
    displayColumns: CASH_BOOK_COLS,
  },
  'bank-book': {
    filters: ['sdt', 'edt', 'mcode'],
    bookDayWiseFormat: true,
    compactEntry: true,
    compactTable: true,
    voucherEntryDrill: true,
    filterOverrides: { mcode: BANK_ACCOUNT_FILTER },
    displayColumns: CASH_BOOK_COLS,
  },
  'journal-book': {
    filters: ['sdt', 'edt'],
    compactEntry: true,
    compactTable: true,
    voucherLedgerDrill: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'DETAIL',
    displayColumns: JOURNAL_DETAIL_COLS,
  },
  'cash-book-sum': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'VR_DATE',
    filterOverrides: { mcode: CASH_ACCOUNT_FILTER },
    displayColumns: BOOK_SUMMARY_COLS,
  },
  'bank-book-sum': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'VR_DATE',
    filterOverrides: { mcode: BANK_ACCOUNT_FILTER },
    displayColumns: BOOK_SUMMARY_COLS,
  },
  'journal-book-sum': {
    filters: ['sdt', 'edt'],
    compactEntry: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'VR_NO',
    displayColumns: [
      dateCol('VR_DATE', 'Date'),
      txtCol('VR_NO', 'No'),
      numCol('DR_AMT', 'Debit'),
      numCol('CR_AMT', 'Credit'),
    ],
  },
  'day-book': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    voucherLedgerDrill: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'NAME',
    filterOverrides: { mcode: CASH_ACCOUNT_FILTER },
    displayColumns: DAY_BOOK_COLS,
  },
  'bank-statement': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'DETAIL',
    filterOverrides: { mcode: BANK_ACCOUNT_FILTER },
    displayColumns: BANK_STMT_COLS,
  },
  'bank-reconc': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'NAME',
    filterOverrides: { mcode: BANK_ACCOUNT_FILTER },
    displayColumns: BANK_RECON_COLS,
  },
};

export const VOUCHER_BOOK_FILTER_LABELS = {
  sdt: 'From Date',
  edt: 'To Date',
  mcode: 'Account Code',
};

export function getVoucherBookReportDef(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return VOUCHER_BOOK_REPORT_DEFS[id] || { filters: ['sdt', 'edt', 'mcode'] };
}

export function resolveVoucherBookReportFilterMeta(reportId, filterKey) {
  const def = getVoucherBookReportDef(reportId);
  const override = def?.filterOverrides?.[filterKey] || {};
  return {
    label: override.label || VOUCHER_BOOK_FILTER_LABELS[filterKey] || humanizeColumnKey(filterKey),
    hint: override.hint,
    pickList: override.pickList || null,
    schedules: override.schedules || null,
    manualCode: override.manualCode === true,
    defaultValue: override.defaultValue != null ? String(override.defaultValue).trim() : '',
    required: override.required === true,
  };
}

export function resolveVoucherBookDisplayColumns(reportId, apiColumns, rows) {
  const def = getVoucherBookReportDef(reportId);
  if (def.displayColumns?.length) return def.displayColumns;
  if (apiColumns?.length) return apiColumns;
  const sample = rows?.[0];
  if (!sample) return [];
  return Object.keys(sample)
    .filter((k) => !k.startsWith('_'))
    .map((k) => txtCol(k, humanizeColumnKey(k)));
}

export function isVoucherBookCashOpenRow(row) {
  return String(row?._ROW_KIND ?? '').toLowerCase() === 'cash_open';
}

export function isVoucherBookDayTotalRow(row) {
  return String(row?._ROW_KIND ?? '').toLowerCase() === 'day_total';
}

export function isVoucherBookDayCloseRow(row) {
  return String(row?._ROW_KIND ?? '').toLowerCase() === 'day_close';
}

export function isVoucherBookSummaryRow(row) {
  const k = String(row?._ROW_KIND ?? '').toLowerCase();
  return k === 'cash_open' || k === 'day_total' || k === 'day_close';
}
