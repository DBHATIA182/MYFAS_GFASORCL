/**
 * GFASORCL Other Reports — from VFP BW_MENU popup otherreports (menu/BW_MENU.MPR).
 * Live VFP: e:\gfasorcl\menu · forms · prg · reports
 * Router: prg/other_rpt.prg (DO OTHER_RPT WITH 'A'..'Z')
 */

import { GFASORCL_VFP_PATHS } from './gfasorclVfpPaths';

export const OTHER_REPORTS_PLACEHOLDER_SLIDE = 90;

/** Live other reports screen (all 26 BW_MENU otherreports items). */
export const OTHER_REPORTS_REPORT_SLIDE = 91;

export const OTHER_REPORTS_MENU_MODULE_ID = 'other-reports';

export const OTHER_REPORTS_CATEGORIES = [
  { id: 'labour', label: 'Labour' },
  { id: 'brokerage', label: 'Brokerage' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'trading', label: 'Trading' },
  { id: 'broker-accounts', label: 'Broker accounts' },
  { id: 'chant', label: 'Chant formats' },
  { id: 'vouchers', label: 'Vouchers' },
  { id: 'party-ledgers', label: 'Party ledgers' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'export', label: 'Excel / combined' },
];

/** @type {Array<{ id: string, category: string, title: string, shortTitle: string, description: string, vfpCommand: string, vfpCode: string, vfpFiles?: string[], vfpNote?: string, implemented?: boolean, slide?: number }>} */
export const OTHER_REPORTS_MODULE_ITEMS = [
  {
    id: 'labour-report',
    category: 'labour',
    title: 'Labour Report',
    shortTitle: 'Labour',
    description: 'Labour and dalali amounts by date (lot stock)',
    vfpCommand: "DO OTHER_RPT WITH 'A'",
    vfpCode: 'A',
    vfpFiles: ['forms/labrpt.scx', 'prg/labour.prg', 'prg/other_rpt.prg'],
    vfpNote: 'Opens DO FORM LABRPT',
    implemented: true,
    slide: 91,
  },
  {
    id: 'brokerage-date-wise',
    category: 'brokerage',
    title: 'Brokerage Report Date Wise',
    shortTitle: 'Broker Date',
    description: 'Brokerage by bill date',
    vfpCommand: "DO OTHER_RPT WITH 'B'",
    vfpCode: 'B',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg', 'prg/other_rpt.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 4',
  },
  {
    id: 'brokerage-item-wise',
    category: 'brokerage',
    title: 'Brokerage Report Item Wise',
    shortTitle: 'Broker Item',
    description: 'Brokerage grouped by item',
    vfpCommand: "DO OTHER_RPT WITH 'C'",
    vfpCode: 'C',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 1',
  },
  {
    id: 'insurance-report',
    category: 'insurance',
    title: 'Insurance Report',
    shortTitle: 'Insurance',
    description: 'Insurance policy report',
    vfpCommand: "DO OTHER_RPT WITH 'D'",
    vfpCode: 'D',
    vfpFiles: ['forms/ins_rpt.scx', 'prg/other_rpt.prg'],
    vfpNote: 'DO FORM INS_RPT WITH 1',
  },
  {
    id: 'brokerage-item-cat-wise',
    category: 'brokerage',
    title: 'Brokerage Report Item Cat Wise',
    shortTitle: 'Broker Cat',
    description: 'Brokerage by item category (detail or summary)',
    vfpCommand: "DO OTHER_RPT WITH 'E'",
    vfpCode: 'E',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 2 (detail) or 3 (summary)',
  },
  {
    id: 'broker-summary',
    category: 'broker-accounts',
    title: 'Broker Summary',
    shortTitle: 'Broker Sum',
    description: 'Broker-wise summary totals',
    vfpCommand: "DO OTHER_RPT WITH 'G'",
    vfpCode: 'G',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 5',
  },
  {
    id: 'trading-exp',
    category: 'trading',
    title: 'Trading Exp.',
    shortTitle: 'Trading Exp',
    description: 'Trading expenses report',
    vfpCommand: "DO OTHER_RPT WITH 'H'",
    vfpCode: 'H',
    vfpFiles: ['forms/tdgexp.scx', 'prg/other_rpt.prg'],
    vfpNote: 'DO FORM TDGEXP',
  },
  {
    id: 'broker-ledger',
    category: 'broker-accounts',
    title: 'Broker Ledger',
    shortTitle: 'Broker Ledger',
    description: 'Broker account ledger',
    vfpCommand: "DO OTHER_RPT WITH 'I'",
    vfpCode: 'I',
    vfpFiles: ['forms/brokleg.scx'],
    vfpNote: 'DO FORM BROKLEG',
  },
  {
    id: 'broker-trial',
    category: 'broker-accounts',
    title: 'Broker Trial',
    shortTitle: 'Broker Trial',
    description: 'Broker trial balance',
    vfpCommand: "DO OTHER_RPT WITH 'J'",
    vfpCode: 'J',
    vfpFiles: ['forms/broktrl.scx'],
    vfpNote: 'DO FORM BROKTRL',
  },
  {
    id: 'paploo-report',
    category: 'broker-accounts',
    title: 'Paploo Report',
    shortTitle: 'Paploo',
    description: 'Paploo (weight adjustment) report',
    vfpCommand: "DO OTHER_RPT WITH 'K'",
    vfpCode: 'K',
    vfpFiles: ['forms/paploo.scx'],
    vfpNote: 'DO FORM PAPLOO',
  },
  {
    id: 'brokerage-purchase',
    category: 'brokerage',
    title: 'Brokerage Report Purchase',
    shortTitle: 'Broker Purchase',
    description: 'Purchase-side brokerage',
    vfpCommand: "DO OTHER_RPT WITH 'L'",
    vfpCode: 'L',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 6',
  },
  {
    id: 'voucher-adv-payment-revd',
    category: 'vouchers',
    title: 'Voucher List Adv.Payment Revd.',
    shortTitle: 'Adv Pmt Revd',
    description: 'Advance payment reversed voucher list',
    vfpCommand: "DO OTHER_RPT WITH 'M'",
    vfpCode: 'M',
    vfpFiles: ['forms/std.scx'],
    vfpNote: "DO FORM STD WITH 'H'",
  },
  {
    id: 'chant-format-1',
    category: 'chant',
    title: 'Chant Format 1',
    shortTitle: 'Chant 1',
    description: 'Chant report format 1',
    vfpCommand: "DO OTHER_RPT WITH 'N'",
    vfpCode: 'N',
    vfpFiles: ['forms/chant.scx'],
    vfpNote: 'DO FORM CHANT WITH 1',
  },
  {
    id: 'chant-format-2',
    category: 'chant',
    title: 'Chant Format 2',
    shortTitle: 'Chant 2',
    description: 'Chant report format 2',
    vfpCommand: "DO OTHER_RPT WITH 'O'",
    vfpCode: 'O',
    vfpFiles: ['forms/chant.scx'],
    vfpNote: 'DO FORM CHANT WITH 2',
  },
  {
    id: 'chant-format-3',
    category: 'chant',
    title: 'Chant Format 3',
    shortTitle: 'Chant 3',
    description: 'Chant report format 3',
    vfpCommand: "DO OTHER_RPT WITH 'P'",
    vfpCode: 'P',
    vfpFiles: ['forms/chant.scx'],
    vfpNote: 'DO FORM CHANT WITH 3',
  },
  {
    id: 'chant-summary',
    category: 'chant',
    title: 'Chant Summary',
    shortTitle: 'Chant Sum',
    description: 'Chant summary report',
    vfpCommand: "DO OTHER_RPT WITH 'Q'",
    vfpCode: 'Q',
    vfpFiles: ['forms/chant.scx'],
    vfpNote: 'DO FORM CHANT WITH 4',
  },
  {
    id: 'broker-wise-scheme',
    category: 'brokerage',
    title: 'Broker Wise Scheme',
    shortTitle: 'Broker Scheme',
    description: 'Broker scheme report',
    vfpCommand: "DO OTHER_RPT WITH 'R'",
    vfpCode: 'R',
    vfpFiles: ['forms/brokrpt1.scx'],
    vfpNote: 'DO FORM BROKRPT1 WITH 1',
  },
  {
    id: 'broker-dalali-less-freight',
    category: 'brokerage',
    title: 'Broker Wise Dalali Less Freight',
    shortTitle: 'Dalali − Freight',
    description: 'Dalali after freight deduction',
    vfpCommand: "DO OTHER_RPT WITH 'S'",
    vfpCode: 'S',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 7',
  },
  {
    id: 'freight-party-ledger',
    category: 'party-ledgers',
    title: 'Freight Party Ledger',
    shortTitle: 'Freight Ledger',
    description: 'Freight party ledger',
    vfpCommand: "DO OTHER_RPT WITH 'T'",
    vfpCode: 'T',
    vfpFiles: ['forms/cleger.scx'],
    vfpNote: 'DO FORM CLEGER WITH 11',
  },
  {
    id: 'indent-party-ledger',
    category: 'party-ledgers',
    title: 'Indent Party Ledger',
    shortTitle: 'Indent Ledger',
    description: 'Indent party ledger',
    vfpCommand: "DO OTHER_RPT WITH 'U'",
    vfpCode: 'U',
    vfpFiles: ['forms/cleger.scx'],
    vfpNote: 'DO FORM CLEGER WITH 10',
  },
  {
    id: 'purchase-outstanding-month',
    category: 'outstanding',
    title: 'Month wise Purchase/OutStanding',
    shortTitle: 'Pur Outstanding',
    description: 'Month-wise purchase outstanding',
    vfpCommand: "DO OTHER_RPT WITH 'V'",
    vfpCode: 'V',
    vfpFiles: ['forms/totout.scx'],
    vfpNote: 'DO FORM TOTOUT WITH 3',
  },
  {
    id: 'sale-outstanding-month',
    category: 'outstanding',
    title: 'Month Wise Sale/OutStanding',
    shortTitle: 'Sale Outstanding',
    description: 'Month-wise sale outstanding',
    vfpCommand: "DO OTHER_RPT WITH 'W'",
    vfpCode: 'W',
    vfpFiles: ['forms/totout.scx'],
    vfpNote: 'DO FORM TOTOUT WITH 2',
  },
  {
    id: 'dalali-excel',
    category: 'export',
    title: 'Bill Wise Dalali Report Excel',
    shortTitle: 'Dalali Excel',
    description: 'Bill-wise dalali export to Excel',
    vfpCommand: "DO OTHER_RPT WITH 'Y'",
    vfpCode: 'Y',
    vfpFiles: ['forms/brokrpt.scx', 'prg/broker.prg'],
    vfpNote: 'DO FORM BROKRPT WITH 9',
  },
  {
    id: 'combined-sale-purchase',
    category: 'export',
    title: 'Combind Report Sale/Purchase',
    shortTitle: 'Sale + Purchase',
    description: 'Combined sale and purchase report',
    vfpCommand: "DO OTHER_RPT WITH 'Z'",
    vfpCode: 'Z',
    vfpFiles: ['forms/combind_report.scx'],
    vfpNote: 'DO FORM COMBIND_REPORT WITH 1',
  },
];

const OTHER_REPORTS_BY_ID = Object.fromEntries(OTHER_REPORTS_MODULE_ITEMS.map((m) => [m.id, m]));

export function findOtherReportsModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return OTHER_REPORTS_BY_ID[id] || null;
}

export function isOtherReportsModuleReport(reportId) {
  return Boolean(findOtherReportsModuleItem(reportId));
}

export function otherReportsCategoryLabel(categoryId) {
  const c = OTHER_REPORTS_CATEGORIES.find((x) => x.id === categoryId);
  return c?.label || categoryId || '';
}

export function resolveOtherReportsSlideNo(reportType) {
  const item = findOtherReportsModuleItem(reportType);
  if (!item) return null;
  return OTHER_REPORTS_REPORT_SLIDE;
}

/** Menu tiles for reportMenuConfig other-reports section. */
export function otherReportsMenuItemsForReportConfig() {
  return OTHER_REPORTS_MODULE_ITEMS.map((m) => ({
    id: m.id,
    title: m.title,
    shortTitle: m.shortTitle,
    description: m.description,
  }));
}

export { GFASORCL_VFP_PATHS };
