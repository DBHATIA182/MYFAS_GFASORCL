/**
 * Voucher module books — VFP BW_MENU books popup (rptcasbk, rptbanbk, rptjoubk, DAYBOOK).
 * Logic: prg/BOOKS.PRG · forms · reports
 */

import { VOUCHER_MENU_MODULE_ID } from './transactionModuleConfig';
import { GFASORCL_VFP_PATHS } from './gfasorclVfpPaths';

export const VOUCHER_BOOKS_REPORT_SLIDE = 99;

/** @type {Array<{ id: string, title: string, shortTitle: string, description: string, vfpCommand: string, vfpFiles?: string[], implemented?: boolean, slide?: number }>} */
export const VOUCHER_BOOKS_MODULE_ITEMS = [
  {
    id: 'cash-book',
    title: 'Cash Book',
    shortTitle: 'Cash Book',
    description: 'Cash account ledger with opening balance',
    vfpCommand: "do FORM rptcasbk with ''",
    vfpFiles: ['forms/rptcasbk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'bank-book',
    title: 'Bank Book',
    shortTitle: 'Bank Book',
    description: 'Bank account ledger with opening balance',
    vfpCommand: "do FORM rptbanbk with ''",
    vfpFiles: ['forms/rptbanbk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'journal-book',
    title: 'Journal Book',
    shortTitle: 'Journal Book',
    description: 'Journal vouchers by date',
    vfpCommand: "do FORM rptjoubk with ''",
    vfpFiles: ['forms/rptjoubk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'cash-book-sum',
    title: 'CashBookSum',
    shortTitle: 'Cash Summary',
    description: 'Cash book date-wise summary',
    vfpCommand: "do FORM rptcasbk with 'S'",
    vfpFiles: ['forms/rptcasbk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'bank-book-sum',
    title: 'BankBookSum',
    shortTitle: 'Bank Summary',
    description: 'Bank book date-wise summary',
    vfpCommand: "do FORM rptbanbk with 'S'",
    vfpFiles: ['forms/rptbanbk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'journal-book-sum',
    title: 'JournalBookSum',
    shortTitle: 'Journal Summary',
    description: 'Journal vouchers grouped by date and number',
    vfpCommand: "do FORM rptjoubk with 'S'",
    vfpFiles: ['forms/rptjoubk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'day-book',
    title: 'DayBook',
    shortTitle: 'Day Book',
    description: 'Day book — cash, bank and journal vouchers',
    vfpCommand: "do FORM DAYBOOK with 'D'",
    vfpFiles: ['forms/daybook.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'bank-statement',
    title: 'BankStatement',
    shortTitle: 'Bank Statement',
    description: 'Bank statement with opening balance',
    vfpCommand: "do form rptbanbk with 'A'",
    vfpFiles: ['forms/rptbanbk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
  {
    id: 'bank-reconc',
    title: 'BankReconc',
    shortTitle: 'Bank Reconc',
    description: 'Bank reconciliation statement',
    vfpCommand: "do FORM rptbanbk with 'B'",
    vfpFiles: ['forms/rptbanbk.scx', 'prg/BOOKS.PRG'],
    implemented: true,
    slide: 99,
  },
];

const VOUCHER_BOOKS_BY_ID = Object.fromEntries(VOUCHER_BOOKS_MODULE_ITEMS.map((m) => [m.id, m]));

export function findVoucherBooksModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return VOUCHER_BOOKS_BY_ID[id] || null;
}

export function isVoucherBooksModuleReport(reportId) {
  return Boolean(findVoucherBooksModuleItem(reportId));
}

export function resolveVoucherBooksSlideNo(reportType) {
  return findVoucherBooksModuleItem(reportType) ? VOUCHER_BOOKS_REPORT_SLIDE : null;
}

/** Menu tiles for Vouchers module grid. */
export function voucherBooksMenuItemsForReportConfig() {
  return VOUCHER_BOOKS_MODULE_ITEMS.map((item) => ({
    id: item.id,
    title: item.title,
    shortTitle: item.shortTitle,
    description: item.description,
  }));
}

export function resolveVoucherBooksMenuModule() {
  return VOUCHER_MENU_MODULE_ID;
}

export { GFASORCL_VFP_PATHS, VOUCHER_MENU_MODULE_ID };
