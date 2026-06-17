/**
 * GFASORCL Utilities module — from VFP-IMPORT/UTILITIES.txt (legacy Utilities menu).
 */

import {
  isDesktopOnlyFrozen,
  DESKTOP_ONLY_UTILITY_MESSAGE,
  GENERIC_DESKTOP_ONLY_UTILITY_MESSAGE,
  MOBILE_ONLY_UTILITY_MESSAGE,
  GENERIC_MOBILE_ONLY_UTILITY_MESSAGE,
  PRIMARY_KEY_DESKTOP_ONLY_MESSAGE,
  SET_FUNCTION_DESKTOP_ONLY_MESSAGE,
  TAKAJA_QUERY_DESKTOP_ONLY_MESSAGE,
} from '../utils/appViewMode';

export const UTILITIES_PLACEHOLDER_SLIDE = 49;

export const UTILITY_CATEGORIES = [
  { id: 'session', label: 'Session' },
  { id: 'new-year-creation', label: 'New Year Creation' },
  { id: 'multi-utilities', label: 'Multi Utilities' },
  { id: 'transfer-utilities', label: 'Transfer Utilities' },
  { id: 'user-reports', label: 'User Reports' },
  { id: 'installation', label: 'Installation' },
];

/** @type {Array<{ id: string, category: string, title: string, shortTitle: string, description: string, vfpCommand: string, vfpFiles?: string[], implemented?: boolean, navSlide?: number, slide?: number, logout?: boolean, desktopOnly?: boolean, mobileOnly?: boolean }>} */
export const UTILITIES_MODULE_ITEMS = [
  {
    id: 'change-year',
    category: 'session',
    title: 'Change Year',
    shortTitle: 'Change Year',
    description: 'Select another financial year',
    vfpCommand: 'DO FORM yearsel',
    implemented: true,
    navSlide: 2,
  },
  {
    id: 'change-company',
    category: 'session',
    title: 'Change Company',
    shortTitle: 'Change Co.',
    description: 'Select another company',
    vfpCommand: 'DO FORM compsel',
    implemented: true,
    navSlide: 1,
  },
  {
    id: 'change-user',
    category: 'session',
    title: 'Change User',
    shortTitle: 'Change User',
    description: 'Sign in as a different user',
    vfpCommand: 'DO FORM user',
    implemented: true,
    navSlide: 1,
    logout: true,
  },
  {
    id: 'new-year-books',
    category: 'new-year-creation',
    title: 'New Year Books',
    shortTitle: 'New Year',
    description: 'Prepare books for a new year',
    vfpCommand: 'DO FORM prepare',
    implemented: true,
    slide: 50,
    desktopOnly: true,
  },
  {
    id: 'primary-key',
    category: 'new-year-creation',
    title: 'Primary Key',
    shortTitle: 'Primary Key',
    description: 'Rebuild primary keys',
    vfpCommand: 'DO primary_key',
    vfpFiles: ['primary_key.prg', 'PRIMARY_KEY.TXT'],
    implemented: true,
    slide: 51,
    desktopOnly: true,
  },
  {
    id: 'set-function',
    category: 'new-year-creation',
    title: 'Set Function',
    shortTitle: 'Set Func',
    description: 'Set system functions',
    vfpCommand: 'DO setFUNC',
    vfpFiles: ['setfunc.prg', 'ORAFUN.TXT', 'TAKAJAFUN.TXT', 'SORAFUN.TXT'],
    implemented: true,
    slide: 52,
    desktopOnly: true,
  },
  {
    id: 'takaja-query',
    category: 'new-year-creation',
    title: 'Takaja Query',
    shortTitle: 'Takaja',
    description: 'Run Takaja query utility',
    vfpCommand: 'DO TAKAJA_QUERY',
    vfpFiles: ['takaja_query.prg', 'TAKAJAFUN.TXT'],
    implemented: true,
    slide: 53,
    desktopOnly: true,
  },
  {
    id: 'opening-bills-detail',
    category: 'multi-utilities',
    title: 'Opening Bills Detail',
    shortTitle: 'Op. Bills',
    description: 'Opening bills detail',
    vfpCommand: 'DO FORM OPDET',
    vfpFiles: ['opdet.scx', 'opdet.SCT'],
    implemented: true,
    slide: 54,
    desktopOnly: true,
  },
  {
    id: 'interest-transfer',
    category: 'multi-utilities',
    title: 'Interest Transfer',
    shortTitle: 'Int. Trf',
    description: 'Transfer interest balances',
    vfpCommand: 'DO FORM INTTRF',
    vfpFiles: ['inttrf.scx', 'inttrf.SCT'],
    implemented: true,
    slide: 55,
    desktopOnly: true,
  },
  {
    id: 'square-up-accounts',
    category: 'multi-utilities',
    title: 'SquareUp Accounts',
    shortTitle: 'Square Up',
    description: 'Square up account balances',
    vfpCommand: 'DO FORM SQUARE',
    vfpFiles: ['square.scx', 'square.SCT'],
    implemented: true,
    slide: 57,
    desktopOnly: true,
  },
  {
    id: 'trial-difference',
    category: 'multi-utilities',
    title: 'Trial Difference',
    shortTitle: 'Trial Diff',
    description: 'Trial balance difference report',
    vfpCommand: 'DO trldif',
    vfpFiles: ['trldif.prg'],
    implemented: true,
    slide: 58,
  },
  {
    id: 'merging-of-accounts',
    category: 'multi-utilities',
    title: 'Merging Of Accounts',
    shortTitle: 'Merge A/c',
    description: 'Merge duplicate accounts',
    vfpCommand: 'DO FORM amerge',
    vfpFiles: ['amerge.scx', 'amerge.SCT'],
    implemented: true,
    slide: 59,
    desktopOnly: true,
  },
  {
    id: 'bikri-no-merging',
    category: 'multi-utilities',
    title: 'Bikri No. Merging',
    shortTitle: 'Bikri Merge',
    description: 'Merge bikri numbers',
    vfpCommand: 'DO FORM bnotrf',
    vfpFiles: ['bnotrf.scx', 'bnotrf.SCT'],
    implemented: true,
    slide: 60,
    desktopOnly: true,
  },
  {
    id: 'bikri-no-trf-to-lot',
    category: 'multi-utilities',
    title: 'Bikri No Trf To Lot',
    shortTitle: 'Bikri→Lot',
    description: 'Transfer bikri number to lot',
    vfpCommand: 'DO FORM bnotrf_lot',
    vfpFiles: ['bnotrf_lot.scx', 'bnotrf_lot.SCT'],
    implemented: true,
    slide: 61,
    desktopOnly: true,
  },
  {
    id: 'shortage-transfer',
    category: 'multi-utilities',
    title: 'Shortage Transfer',
    shortTitle: 'Shortage',
    description: 'Transfer shortage entries',
    vfpCommand: 'DO FORM shortage',
    vfpFiles: ['shortage.scx', 'shortage.SCT'],
    implemented: true,
    slide: 62,
    desktopOnly: true,
  },
  {
    id: 'unused-account-list',
    category: 'multi-utilities',
    title: 'Unused Account List',
    shortTitle: 'Unused A/c',
    description: 'List unused accounts',
    vfpCommand: 'DO FORM master_delete',
    vfpFiles: ['master_delete.scx', 'master_delete.SCT'],
    implemented: true,
    slide: 63,
    desktopOnly: true,
  },
  {
    id: 'unused-cost-centre-codes',
    category: 'multi-utilities',
    title: 'Unused Cost Centre Codes',
    shortTitle: 'Unused CC',
    description: 'List unused cost centre codes',
    vfpCommand: 'DO FORM cost_delete',
    vfpFiles: ['cost_delete.scx', 'cost_delete.SCT'],
    implemented: true,
    slide: 64,
    desktopOnly: true,
  },
  {
    id: 'unused-godown-codes',
    category: 'multi-utilities',
    title: 'Unused Godown Codes',
    shortTitle: 'Unused GD',
    description: 'List unused godown codes',
    vfpCommand: 'DO FORM godown_delete',
    vfpFiles: ['godown_delete.scx', 'godown_delete.SCT'],
    implemented: true,
    slide: 65,
    desktopOnly: true,
  },
  {
    id: 'missing-codes',
    category: 'multi-utilities',
    title: 'Missing Codes',
    shortTitle: 'Missing',
    description: 'Find missing master codes',
    vfpCommand: 'DO FORM master_missing_numbers',
    vfpFiles: ['master_missing_numbers.scx', 'master_missing_numbers.SCT'],
    implemented: true,
    slide: 66,
    desktopOnly: true,
  },
  {
    id: 'brok-find',
    category: 'transfer-utilities',
    title: 'Brok.Find',
    shortTitle: 'Brok Find',
    description: 'Broker find / check',
    vfpCommand: 'DO FORM brokchk WITH 1',
    vfpFiles: ['brokchk.scx', 'brokchk.SCT'],
    implemented: true,
    slide: 67,
    desktopOnly: true,
  },
  {
    id: 'dane-find',
    category: 'transfer-utilities',
    title: 'Dane Find',
    shortTitle: 'Dane Find',
    description: 'Dane find / check',
    vfpCommand: 'DO FORM brokchk WITH 2',
    vfpFiles: ['brokchk.scx', 'brokchk.SCT'],
    implemented: true,
    slide: 68,
    desktopOnly: true,
  },
  {
    id: 'stock-transfer',
    category: 'transfer-utilities',
    title: 'Stock Transfer',
    shortTitle: 'Stk Trf',
    description: 'Rebuild LOTSTOCK from Purchase / Sale / CPUR / Production',
    vfpCommand: 'DO FORM stktrf',
    vfpFiles: ['stktrf.scx', 'stktrf.SCT'],
    implemented: true,
    slide: 69,
    desktopOnly: true,
  },
  {
    id: 'sale-transfer',
    category: 'transfer-utilities',
    title: 'Sale Transfer',
    shortTitle: 'Sale Trf',
    description: 'Re-post sale bills to LOTSTOCK (VFP saletrf / SALE_GST transfer)',
    vfpCommand: "DO FORM saletrf WITH ctod('  /  /    '),ctod('  /  /    '),''",
    vfpFiles: ['saletrf.scx', 'saletrf.SCT', 'sale_gst.scx', 'sale_gst.SCT'],
    implemented: true,
    slide: 70,
    desktopOnly: true,
  },
  {
    id: 'freight-voucher',
    category: 'transfer-utilities',
    title: 'Freight Voucher',
    shortTitle: 'Freight',
    description: 'Freight voucher transfer',
    vfpCommand: 'DO FORM fgttrf',
  },
  {
    id: 'voucher-transfer',
    category: 'transfer-utilities',
    title: 'Voucher Transfer',
    shortTitle: 'Vou Trf',
    description: 'Re-post cash/bank/journal vouchers to LEDGER (VFP voutrf / VOUCHER transfer)',
    vfpCommand: 'DO FORM voutrf',
    vfpFiles: ['voutrf.scx', 'voutrf.SCT', 'voucher.scx', 'voucher.SCT'],
    implemented: true,
    slide: 71,
    desktopOnly: true,
  },
  {
    id: 'purchase-transfer',
    category: 'transfer-utilities',
    title: 'Purchase Transfer',
    shortTitle: 'Pur Trf',
    description: 'Re-post PU purchase bills to LOTSTOCK (VFP purtrf / PURCHASE_GST transfer)',
    vfpCommand: 'DO FORM purtrf',
    vfpFiles: ['purtrf.scx', 'purtrf.SCT'],
    implemented: true,
    slide: 72,
    desktopOnly: true,
  },
  {
    id: 'update-sale-inv-no',
    category: 'transfer-utilities',
    title: 'Update SaleInvNo',
    shortTitle: 'Upd InvNo',
    description: 'Rebuild SALE_INV_NO on sale bills for a date range',
    vfpCommand: 'DO FORM update_sale_inv_no',
    vfpFiles: ['update_sale_inv_no.scx', 'update_sale_inv_no.SCT'],
    implemented: true,
    slide: 73,
    desktopOnly: true,
  },
  {
    id: 'update-pan-with-gstin',
    category: 'transfer-utilities',
    title: 'Update Pan With GstIn',
    shortTitle: 'PAN+GSTIN',
    description: 'Update PAN from GSTIN',
    vfpCommand: 'DO pan_with_gstin',
    vfpFiles: ['PAN_WITH_GSTIN.prg'],
    implemented: true,
    slide: 74,
    desktopOnly: true,
  },
  {
    id: 'user-report',
    category: 'user-reports',
    title: 'User Report',
    shortTitle: 'User Rpt',
    description: 'User activity audit — add, edit, or delete',
    vfpCommand: 'DO FORM userrpt',
    vfpFiles: ['userrpt.scx', 'userrpt.SCT'],
    implemented: true,
    slide: 75,
  },
  {
    id: 'audit-trail-reports',
    category: 'user-reports',
    title: 'Audit Trail Reports',
    shortTitle: 'Audit',
    description: 'Audit trail listing from AUDIT_LEDGER',
    vfpCommand: 'DO FORM audit_report',
    vfpFiles: ['audit_report1.scx', 'audit_report1.SCT'],
    implemented: true,
    slide: 76,
  },
  {
    id: 'company-detail-edit',
    category: 'installation',
    title: 'Company Detail Edit',
    shortTitle: 'Comp Det',
    description: 'Edit company details (compdet)',
    vfpCommand: 'DO FORM compdet',
    vfpFiles: ['compdet.scx', 'compdet.SCT'],
    implemented: true,
    slide: 77,
  },
  {
    id: 'gst-profile-setting',
    category: 'installation',
    title: 'Gst Profile Setting',
    shortTitle: 'GST Prof',
    description: 'GST profile settings',
    vfpCommand: 'DO FORM gst_profile',
    vfpFiles: ['gst_profile.scx', 'gst_profile.SCT'],
    implemented: true,
    slide: 78,
  },
  {
    id: 'updation',
    category: 'installation',
    title: 'Updation',
    shortTitle: 'Updation',
    description: 'Data updation utility',
    vfpCommand: 'DO FORM update',
    vfpFiles: ['update.scx', 'update.SCT'],
    implemented: true,
    slide: 79,
    desktopOnly: true,
  },
  {
    id: 'updation-stock',
    category: 'installation',
    title: 'Updation Stock',
    shortTitle: 'Stk Updt',
    description: 'Stock updation utility',
    vfpCommand: 'DO FORM stkupdt',
  },
  {
    id: 'new-company-addition',
    category: 'installation',
    title: 'New Company Addition',
    shortTitle: 'New Co.',
    description: 'Add a new company',
    vfpCommand: 'DO FORM newcomp',
  },
  {
    id: 'set-sale-exp',
    category: 'installation',
    title: 'Set Sale Exp.',
    shortTitle: 'Sale Exp',
    description: 'Set sale expense (GST)',
    vfpCommand: "DO FORM saleform_Gst WITH 'SALE'",
  },
  {
    id: 'default-setting',
    category: 'installation',
    title: 'Default Setting',
    shortTitle: 'Default',
    description: 'Default system settings',
    vfpCommand: 'DO FORM default',
  },
  {
    id: 'default-setting-2',
    category: 'installation',
    title: 'Default Setting 2',
    shortTitle: 'Default 2',
    description: 'Additional default settings',
    vfpCommand: 'DO FORM default2',
  },
  {
    id: 'set-task-scheduler',
    category: 'installation',
    title: 'Set Task Scheduler',
    shortTitle: 'Task Schd',
    description: 'Configure task scheduler',
    vfpCommand: 'DO FORM schtask WITH 1',
  },
];

const UTILITIES_BY_ID = Object.fromEntries(UTILITIES_MODULE_ITEMS.map((u) => [u.id, u]));

export function findUtilitiesModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return UTILITIES_BY_ID[id] || null;
}

export function isUtilitiesModuleReport(reportId) {
  return Boolean(findUtilitiesModuleItem(reportId));
}

/** Route utility reportType to slide number, or null if not a utility screen. */
export function resolveUtilitiesSlideNo(reportType) {
  const item = findUtilitiesModuleItem(reportType);
  if (!item) return null;
  if (isUtilityDesktopOnlyBlocked(item)) return null;
  if (item.navSlide) return item.navSlide;
  if (item.slide) return item.slide;
  return UTILITIES_PLACEHOLDER_SLIDE;
}

export function utilityCategoryLabel(categoryId) {
  return UTILITY_CATEGORIES.find((c) => c.id === categoryId)?.label || categoryId;
}

export function isUtilityDesktopOnlyBlocked(item) {
  if (!item?.desktopOnly) return false;
  return isDesktopOnlyFrozen();
}

export function utilityDesktopOnlyMessage(item) {
  if (item?.id === 'new-year-books') return DESKTOP_ONLY_UTILITY_MESSAGE;
  if (item?.id === 'primary-key') return PRIMARY_KEY_DESKTOP_ONLY_MESSAGE;
  if (item?.id === 'set-function') return SET_FUNCTION_DESKTOP_ONLY_MESSAGE;
  if (item?.id === 'takaja-query') return TAKAJA_QUERY_DESKTOP_ONLY_MESSAGE;
  if (item?.id === 'updation') {
    return 'Updation is available on desktop only. Open the app on a computer, or switch to Desktop View in Settings.';
  }
  if (item?.desktopOnly) return GENERIC_DESKTOP_ONLY_UTILITY_MESSAGE;
  return `${item?.title || 'This utility'} is available on desktop only.`;
}

export function isUtilityMobileOnlyBlocked(item) {
  if (!item?.mobileOnly) return false;
  return !isDesktopOnlyFrozen();
}

export function utilityMobileOnlyMessage(item) {
  if (item?.mobileOnly) return GENERIC_MOBILE_ONLY_UTILITY_MESSAGE;
  return `${item?.title || 'This utility'} is available on mobile only.`;
}

/** Menu tiles for reportMenuConfig utilities-module section. */
export function utilitiesMenuItemsForReportConfig() {
  return UTILITIES_MODULE_ITEMS.map((u) => ({
    id: u.id,
    title: u.title,
    shortTitle: u.shortTitle,
    desktopOnly: Boolean(u.desktopOnly),
    mobileOnly: Boolean(u.mobileOnly),
    description: u.desktopOnly
      ? `${u.description} · Desktop only`
      : u.mobileOnly
        ? `${u.description} · Mobile only`
        : u.implemented
          ? `${u.description} · Opens in web app`
          : `${u.description} · Web UI pending`,
  }));
}
