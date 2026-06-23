/**
 * GFASORCL Income Tax Reports — from VFP BW_MENU popup incometaxr (menu/BW_MENU.MPR).
 * Forms: GFASORCL/forms · Reports: GFASORCL/reports · Programs: GFASORCL/prg
 */

export const INCOME_TAX_PLACEHOLDER_SLIDE = 87;

/** Live income tax report screen (all BW_MENU incometaxr items). */
export const INCOME_TAX_REPORT_SLIDE = 89;

export const INCOME_TAX_CATEGORIES = [
  { id: 'lists', label: 'Party lists' },
  { id: 'party-reports', label: 'Party-wise reports' },
  { id: 'item-reports', label: 'Item-wise reports' },
  { id: 'monthly', label: 'Monthly & schedule' },
  { id: 'excel-export', label: 'Excel / amount filters' },
  { id: 'lot-ledger', label: 'Lot & ledger' },
  { id: 'cash-expenses', label: 'Cash & expenses' },
  { id: 'payments', label: 'Bill-wise payments' },
  { id: 'broker', label: 'Broker sales' },
];

const ITAX_FORM = ['forms/itaxrpt.scx'];

/** @type {Array<{ id: string, category: string, title: string, shortTitle: string, description: string, vfpCommand: string, vfpFiles?: string[], vfpNote?: string, implemented?: boolean, slide?: number }>} */
export const INCOME_TAX_MODULE_ITEMS = [
  {
    id: 'loaner-list',
    category: 'lists',
    title: 'Loaner List',
    shortTitle: 'Loaner List',
    description: 'Loaner party list (VFP LOANER mode A)',
    vfpCommand: "DO FORM LOANER WITH 'A'",
    vfpFiles: ['forms/loaner.scx', 'prg/itaxrpt.prg', 'reports/loanlst.frx'],
    implemented: true,
    slide: 89,
  },
  {
    id: 'broker-list',
    category: 'lists',
    title: 'Broker List',
    shortTitle: 'Broker List',
    description: 'Broker party list (VFP LOANER mode C)',
    vfpCommand: "DO FORM LOANER WITH 'C'",
    vfpFiles: ['forms/loaner.scx', 'prg/itaxrpt.prg'],
    implemented: true,
    slide: 89,
  },
  {
    id: 'party-wise-purchase',
    category: 'party-reports',
    title: 'Party Wise Purchase',
    shortTitle: 'Party Purchase',
    description: 'Party-wise purchase for income tax',
    vfpCommand: "DO FORM ITAXRPT WITH 'A'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXPUR.FRX'],
    vfpNote: 'Mode A — party-wise purchase',
  },
  {
    id: 'party-wise-sales',
    category: 'party-reports',
    title: 'Party Wise Sales',
    shortTitle: 'Party Sales',
    description: 'Party-wise sales for income tax',
    vfpCommand: "DO FORM ITAXRPT WITH 'B'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale.frx'],
    vfpNote: 'Mode B — party-wise sales',
  },
  {
    id: 'month-schedule-wise-list',
    category: 'monthly',
    title: 'Month Wise Schedule Wise List',
    shortTitle: 'Schedule List',
    description: 'Month and schedule wise summary',
    vfpCommand: "DO FORM ITAXRPT WITH 'C'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXSCH.FRX'],
    vfpNote: 'Mode C',
  },
  {
    id: 'customer-arhat',
    category: 'party-reports',
    title: 'Customer Arhat',
    shortTitle: 'Customer Arhat',
    description: 'Customer arhat report',
    vfpCommand: "DO FORM ITAXRPT WITH 'D'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxarh.frx'],
    vfpNote: 'Mode D',
  },
  {
    id: 'dami-wise-sales',
    category: 'party-reports',
    title: 'Dami Wise Sales',
    shortTitle: 'Dami Sales',
    description: 'Dami-wise sales',
    vfpCommand: "DO FORM ITAXRPT WITH 'E'",
    vfpFiles: [...ITAX_FORM, 'reports/SALE_ITAX.FRX'],
    vfpNote: 'Mode E',
  },
  {
    id: 'monthly-purchase-report',
    category: 'monthly',
    title: 'Monthly Purchase Report',
    shortTitle: 'Monthly Purchase',
    description: 'Month-wise purchase totals',
    vfpCommand: "DO FORM ITAXRPT WITH 'F'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXPUR.FRX'],
    vfpNote: 'Mode F',
  },
  {
    id: 'monthly-sales-report',
    category: 'monthly',
    title: 'Monthly Sales Report',
    shortTitle: 'Monthly Sales',
    description: 'Month-wise sales totals',
    vfpCommand: "DO FORM ITAXRPT WITH 'G'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale.frx'],
    vfpNote: 'Mode G',
  },
  {
    id: 'item-wise-purchase-sale',
    category: 'item-reports',
    title: 'Item Wise Purchase/Sale',
    shortTitle: 'Item Pur/Sale',
    description: 'Item-wise purchase and sale combined',
    vfpCommand: "DO FORM ITAXRPT WITH 'H'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXITEM_PUR.FRX', 'reports/itaxitem_sale.frx'],
    vfpNote: 'Mode H',
  },
  {
    id: 'item-wise-sales-dami',
    category: 'item-reports',
    title: 'Item Wise Sales/Dami',
    shortTitle: 'Item Sales/Dami',
    description: 'Item-wise sales and dami',
    vfpCommand: "DO FORM ITAXRPT WITH 'I'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxitem_sale.frx'],
    vfpNote: 'Mode I',
  },
  {
    id: 'party-wise-purchase-bill',
    category: 'party-reports',
    title: 'Party Wise Purchase Bill Wise',
    shortTitle: 'Pur Bill Wise',
    description: 'Party-wise purchase bill detail',
    vfpCommand: "DO FORM ITAXRPT WITH 'J'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXPUR_BILL.FRX'],
    vfpNote: 'Mode J',
  },
  {
    id: 'party-wise-sale-bill',
    category: 'party-reports',
    title: 'Party Wise Sale Bill Wise',
    shortTitle: 'Sale Bill Wise',
    description: 'Party-wise sale bill detail',
    vfpCommand: "DO FORM ITAXRPT WITH 'K'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale_bill.frx'],
    vfpNote: 'Mode K',
  },
  {
    id: 'party-wise-purchase-item',
    category: 'party-reports',
    title: 'Party Wise Purchase Item Wise',
    shortTitle: 'Pur Item Wise',
    description: 'Party-wise purchase by item',
    vfpCommand: "DO FORM ITAXRPT WITH 'L'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXPUR_ITEM.FRX'],
    vfpNote: 'Mode L',
  },
  {
    id: 'party-wise-sale-item',
    category: 'party-reports',
    title: 'Party Wise Sale Item Wise',
    shortTitle: 'Sale Item Wise',
    description: 'Party-wise sale by item',
    vfpCommand: "DO FORM ITAXRPT WITH 'M'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale_item.frx'],
    vfpNote: 'Mode M',
  },
  {
    id: 'item-wise-sales-party',
    category: 'item-reports',
    title: 'Item Wise Sales Party Wise',
    shortTitle: 'Item→Party Sales',
    description: 'Item-wise sales with party breakdown',
    vfpCommand: "DO FORM ITAXRPT WITH 'N'",
    vfpFiles: [...ITAX_FORM, 'reports/itax_sale_cust.frx'],
    vfpNote: 'Mode N',
  },
  {
    id: 'party-wise-sale-month',
    category: 'party-reports',
    title: 'Party Wise Sale Month Wise',
    shortTitle: 'Sale Month Wise',
    description: 'Party-wise sales by month',
    vfpCommand: "DO FORM ITAXRPT WITH 'O'",
    vfpFiles: [...ITAX_FORM, 'reports/itax_sale_mth.frx'],
    vfpNote: 'Mode O',
  },
  {
    id: 'item-wise-sale-month-party',
    category: 'item-reports',
    title: 'Item Wise Sale Monthly Party Wise',
    shortTitle: 'Item Mth Party',
    description: 'Item-wise monthly sales by party',
    vfpCommand: "DO FORM ITAXRPT WITH 'P'",
    vfpFiles: [...ITAX_FORM, 'reports/itax_sale_item_mth.frx'],
    vfpNote: 'Mode P',
  },
  {
    id: 'supplier-sales-customer-wise',
    category: 'party-reports',
    title: 'Supplier Wise Sales Customer Wise',
    shortTitle: 'Supp→Cust Sales',
    description: 'Supplier-wise sales with customer breakdown',
    vfpCommand: "DO FORM ITAXRPT WITH 'Q'",
    vfpFiles: [...ITAX_FORM, 'reports/itax_sale_cust.frx'],
    vfpNote: 'Mode Q',
  },
  {
    id: 'lot-wise-purchase-sale',
    category: 'lot-ledger',
    title: 'Lot Wise Purchase/Sale',
    shortTitle: 'Lot Pur/Sale',
    description: 'Lot-wise purchase and sale',
    vfpCommand: 'DO FORM lotpursale',
    vfpFiles: ['forms/lotpursale.scx', 'reports/lotpursale.frx'],
  },
  {
    id: 'item-wise-purchase',
    category: 'item-reports',
    title: 'Item Wise Purchase',
    shortTitle: 'Item Purchase',
    description: 'Item-wise purchase',
    vfpCommand: "DO FORM ITAXRPT WITH 'R'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXITEM_PUR.FRX'],
    vfpNote: 'Mode R',
  },
  {
    id: 'item-wise-purchase-monthly',
    category: 'item-reports',
    title: 'Item Wise Purchase Monthly',
    shortTitle: 'Item Pur Monthly',
    description: 'Item-wise purchase by month',
    vfpCommand: "DO FORM ITAXRPT WITH 'S'",
    vfpFiles: [...ITAX_FORM, 'reports/itax_pur_item_mth.frx'],
    vfpNote: 'Mode S',
  },
  {
    id: 'party-wise-sale-tdg-consg',
    category: 'party-reports',
    title: 'Party Wise Sale Tdg/Consg.',
    shortTitle: 'Tdg/Consg Sales',
    description: 'Party-wise trading/consignment sales',
    vfpCommand: "DO FORM ITAXRPT WITH 'T'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale.frx'],
    vfpNote: 'Mode T',
  },
  {
    id: 'sale-above-amount',
    category: 'excel-export',
    title: 'Sale More Then Specific Amount',
    shortTitle: 'Sale > Amount',
    description: 'Sales above a specified amount',
    vfpCommand: "DO FORM ITAXRPT WITH 'U'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale.frx'],
    vfpNote: 'Mode U',
  },
  {
    id: 'sale-detail-excel',
    category: 'excel-export',
    title: 'Sale Detail Excell Sheet',
    shortTitle: 'Sale Excel',
    description: 'Sale detail export to Excel',
    vfpCommand: "DO FORM ITAXRPT WITH 'V'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxsale.frx'],
    vfpNote: 'Mode V — Excel export',
  },
  {
    id: 'item-wise-sales-detail',
    category: 'item-reports',
    title: 'Item Wise Sales Detail',
    shortTitle: 'Item Sales Detail',
    description: 'Item-wise sales detail',
    vfpCommand: "DO FORM ITAXRPT WITH 'X'",
    vfpFiles: [...ITAX_FORM, 'reports/itaxitem_sale.frx'],
    vfpNote: 'Mode X',
  },
  {
    id: 'ledger-dccode-report',
    category: 'lot-ledger',
    title: 'Ledger DcCode Report',
    shortTitle: 'Ledger DcCode',
    description: 'Ledger debit/credit code report',
    vfpCommand: 'DO FORM ledger_dc_code',
    vfpFiles: ['forms/ledger_dc_code.scx', 'reports/ledger_dc_code.frx'],
  },
  {
    id: 'purchase-detail-excel',
    category: 'excel-export',
    title: 'Purchase Detail Excell Sheet',
    shortTitle: 'Purchase Excel',
    description: 'Purchase detail export to Excel',
    vfpCommand: "DO FORM ITAXRPT WITH 'Y'",
    vfpFiles: [...ITAX_FORM, 'reports/ITAXPUR.FRX'],
    vfpNote: 'Mode Y — Excel export',
  },
  {
    id: 'cash-movement-monthly',
    category: 'cash-expenses',
    title: 'Cash Movement Monthly',
    shortTitle: 'Cash Movement',
    description: 'Monthly cash movement (VFP cashflow mode 2)',
    vfpCommand: 'DO FORM cashflow WITH 2',
    vfpFiles: ['forms/cashflow.scx', 'reports/cashflow.frx'],
    vfpNote: 'Parameter 2 — income tax menu',
  },
  {
    id: 'monthly-cash-noncash-exp',
    category: 'cash-expenses',
    title: 'Monthly Cash/Non Cash Exp.',
    shortTitle: 'Cash/Non-Cash Exp',
    description: 'Monthly cash and non-cash expenses',
    vfpCommand: 'DO FORM expenses_monthly WITH 1',
    vfpFiles: ['forms/expenses_monthly.scx'],
    vfpNote: 'Parameter 1',
  },
  {
    id: 'customer-bill-payment-detail',
    category: 'payments',
    title: 'Customer Bill Wise Payment Report Detail',
    shortTitle: 'Cust Pmt Detail',
    description: 'Customer bill-wise payment detail',
    vfpCommand: 'DO FORM cust_pmt WITH 1',
    vfpFiles: ['forms/cust_pmt.scx', 'reports/cust_pmt.frx'],
    vfpNote: 'Parameter 1 — customer detail',
  },
  {
    id: 'customer-bill-payment-summary',
    category: 'payments',
    title: 'Customer Bill Wise Payment Report Summary',
    shortTitle: 'Cust Pmt Summary',
    description: 'Customer bill-wise payment summary',
    vfpCommand: 'DO FORM cust_pmt WITH 2',
    vfpFiles: ['forms/cust_pmt.scx', 'reports/cust_pmt_sum.frx'],
    vfpNote: 'Parameter 2 — customer summary',
  },
  {
    id: 'broker-station-wise-sales',
    category: 'broker',
    title: 'Broker Wise Station wise sales',
    shortTitle: 'Broker Station Sales',
    description: 'Broker and station-wise sales',
    vfpCommand: 'DO FORM broksale WITH 1',
    vfpFiles: ['forms/broksale.scx'],
    vfpNote: 'Parameter 1',
  },
  {
    id: 'supplier-bill-payment-detail',
    category: 'payments',
    title: 'Supplier Bill Wise Payment Report Detail',
    shortTitle: 'Supp Pmt Detail',
    description: 'Supplier bill-wise payment detail',
    vfpCommand: 'DO FORM cust_pmt WITH 3',
    vfpFiles: ['forms/cust_pmt.scx', 'reports/cust_pmt.frx'],
    vfpNote: 'Parameter 3 — supplier detail',
  },
];

const INCOME_TAX_BY_ID = Object.fromEntries(INCOME_TAX_MODULE_ITEMS.map((m) => [m.id, m]));

export function findIncomeTaxModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return INCOME_TAX_BY_ID[id] || null;
}

export function isIncomeTaxModuleReport(reportId) {
  return Boolean(findIncomeTaxModuleItem(reportId));
}

export function incomeTaxCategoryLabel(categoryId) {
  const c = INCOME_TAX_CATEGORIES.find((x) => x.id === categoryId);
  return c?.label || categoryId || '';
}

/** Route reportType to slide number, or null if not an income tax screen. */
export function resolveIncomeTaxSlideNo(reportType) {
  const item = findIncomeTaxModuleItem(reportType);
  if (!item) return null;
  return INCOME_TAX_REPORT_SLIDE;
}

/** Menu tiles for reportMenuConfig income-tax-reports section. */
export function incomeTaxMenuItemsForReportConfig() {
  return INCOME_TAX_MODULE_ITEMS.map((m) => ({
    id: m.id,
    title: m.title,
    shortTitle: m.shortTitle,
    description: m.description,
  }));
}
