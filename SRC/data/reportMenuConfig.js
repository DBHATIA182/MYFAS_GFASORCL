/** GFASORCL main menu — original reports only, plus Sale Chart & Overdue Customers. */

import { masterMenuItemsForReportConfig } from './masterModuleConfig';
import { utilitiesMenuItemsForReportConfig } from './utilitiesModuleConfig';
import { incomeTaxMenuItemsForReportConfig } from './incomeTaxModuleConfig';
import { otherReportsMenuItemsForReportConfig } from './otherReportsModuleConfig';
import {
  transactionMenuItemsForReportConfig,
  voucherTransactionMenuItemsForReportConfig,
  purchaseTransactionMenuItemsForReportConfig,
  salesRootMenuItemsForReportConfig,
  saleTransactionMenuItemsForReportConfig,
} from './transactionModuleConfig';
import { voucherBooksMenuItemsForReportConfig } from './voucherBooksModuleConfig';

export const REPORT_MENU = [
  {
    id: 'final-accounts',
    index: 1,
    sidebarLabel: 'Financial',
    sidebarIcon: '📊',
    title: 'Final Accounts',
    subtitle: 'Trial, P&L, Balance Sheet',
    tileColor: '#2a4fa8',
    items: [
      { id: 'trial-balance', title: 'Trial Balance', shortTitle: 'Trial Balance', description: 'Balances as of date' },
      { id: 'trial-balance-summary', title: 'Trial Balance Summary', shortTitle: 'TB Summary', description: 'Annexure-wise totals' },
      { id: 'trial-date-wise', title: 'Trial Balance Date Wise', shortTitle: 'TB Date Wise', description: 'Opening, movement, closing' },
      { id: 'trading-ac', title: 'Trading A/C', shortTitle: 'Trading A/C', description: 'Trading account' },
      { id: 'pl-profit-loss', title: 'Profit & Loss', shortTitle: 'P & L', description: 'Profit & loss account' },
      { id: 'balance-sheet', title: 'Balance Sheet', shortTitle: 'Balance Sheet', description: 'Assets & liabilities' },
    ],
  },
  {
    id: 'ledger-reports',
    index: 2,
    sidebarLabel: 'Ledgers',
    sidebarIcon: '📒',
    title: 'Ledger Reports',
    subtitle: 'Account & outstanding',
    tileColor: '#0ca678',
    items: [
      { id: 'ledger', title: 'Ledger Report', shortTitle: 'Ledger', description: 'Account transactions' },
      { id: 'complete-ledger', title: 'Complete Ledger', shortTitle: 'Complete Ledger', description: 'All accounts in code range' },
      { id: 'ledger-interest', title: 'Ledger With Interest', shortTitle: 'Ledger + Int.', description: 'Interest calculation' },
      { id: 'customer-ledger', title: 'Customer Ledger', shortTitle: 'Customer Ledger', description: 'Customer bills' },
      {
        id: 'overdue-customers',
        title: 'Overdue Customers',
        shortTitle: 'Overdue Customer',
        description: 'Customers with bills pending over 30 days',
      },
      { id: 'supplier-ledger', title: 'Supplier Ledger', shortTitle: 'Supplier Ledger', description: 'Supplier bills' },
      { id: 'broker-os', title: 'Broker OS', shortTitle: 'Broker OS', description: 'Broker outstanding' },
      { id: 'ageing', title: 'Ageing Report', shortTitle: 'Ageing', description: 'Outstanding by days' },
      {
        id: 'ledger-dr-cr-date',
        title: 'Ledger Dr/Cr Date',
        shortTitle: 'Ledger Dr/Cr',
        description: 'Ledger with separate debit and credit date ranges',
      },
    ],
  },
  {
    id: 'stock-reports',
    index: 3,
    sidebarLabel: 'Stock',
    sidebarIcon: '📦',
    title: 'Stock Reports',
    subtitle: 'Inventory movement',
    tileColor: '#e67e22',
    items: [
      { id: 'stock-sum', title: 'Stock Sum', shortTitle: 'Stock Summary', description: 'Item movement totals' },
      { id: 'stock-lot', title: 'Stock Lot Wise', shortTitle: 'Stock Lot', description: 'Lot-wise stock' },
    ],
  },
  {
    id: 'gst-reports',
    index: 4,
    sidebarLabel: 'GST',
    sidebarIcon: '📋',
    title: 'GST Reports',
    subtitle: 'GSTR-1, HSN & state wise',
    tileColor: '#db2777',
    items: [
      { id: 'gstr1', title: 'GSTR-1', shortTitle: 'GSTR-1', description: 'GST return sheets' },
      { id: 'hsn-sales', title: 'HSN Sales', shortTitle: 'HSN Sales', description: 'HSN-wise sales' },
      { id: 'hsn-purchase', title: 'HSN Purchase', shortTitle: 'HSN Purchase', description: 'HSN-wise purchase' },
      { id: 'state-wise-sales', title: 'State Wise Sales', shortTitle: 'State Sales', description: 'Sales by party state & GST%' },
      { id: 'state-wise-purchase', title: 'State Wise Purchase', shortTitle: 'State Purchase', description: 'Purchase by party state & GST%' },
      {
        id: 'purchase-tds-detail',
        title: 'Party Wise Purchase Detail (TDS)',
        shortTitle: 'Pur. TDS Detail',
        description: 'Bill-wise purchase TDS (NTDS) by party',
      },
      {
        id: 'purchase-tds-summary',
        title: 'Party Wise Purchase Summary (TDS)',
        shortTitle: 'Pur. TDS Summary',
        description: 'Party-wise purchase TDS totals for the period',
      },
      {
        id: 'sale-tds-detail',
        title: 'Party Wise Sale Detail (TDS)',
        shortTitle: 'Sale TDS Detail',
        description: 'Bill-wise sale TDS by party',
      },
      {
        id: 'sale-tds-summary',
        title: 'Party Wise Sale Summary (TDS)',
        shortTitle: 'Sale TDS Summary',
        description: 'Party-wise sale TDS totals for the period',
      },
    ],
  },
  {
    id: 'sales-module',
    index: 5,
    sidebarLabel: 'Sales',
    sidebarIcon: '🛒',
    title: 'Sales',
    subtitle: 'Sale bills, orders, dispatch & export (VFP salerecord menu)',
    tileColor: '#7c3aed',
    itemsSectionTitle: 'Screens',
    items: salesRootMenuItemsForReportConfig(),
  },
  {
    id: 'purchase-module',
    index: 6,
    sidebarLabel: 'Purchase',
    sidebarIcon: '🧾',
    title: 'Purchase',
    subtitle: 'Purchase bills, orders, inward & notes (VFP purchasere menu)',
    tileColor: '#e74c3c',
    itemsSectionTitle: 'Screens',
    items: [
      { id: 'purchase-list', title: 'Purchase List', shortTitle: 'Purchase List', description: 'Purchase bill checklist' },
      ...purchaseTransactionMenuItemsForReportConfig(),
    ],
  },
  {
    id: 'voucher-module',
    index: 7,
    sidebarLabel: 'Vouchers',
    sidebarIcon: '💵',
    title: 'Vouchers',
    subtitle: 'Cash, bank & journal vouchers (VFP transactio voucher menus)',
    tileColor: '#374151',
    itemsSectionTitle: 'Screens',
    items: [
      { id: 'voucher-list', title: 'Voucher Checklist', shortTitle: 'Voucher Checklist', description: 'Find vouchers — all types' },
      ...voucherBooksMenuItemsForReportConfig(),
      ...voucherTransactionMenuItemsForReportConfig(),
    ],
  },
  {
    id: 'transaction-module',
    index: 8,
    sidebarLabel: 'Transaction',
    sidebarIcon: '💳',
    title: 'Transaction',
    subtitle: 'Production, bikri, TDS, bank recon & freight (VFP transactio menu)',
    tileColor: '#c2410c',
    itemsSectionTitle: 'Screens',
    entry: true,
    items: transactionMenuItemsForReportConfig(),
  },
  {
    id: 'master-module',
    index: 9,
    sidebarLabel: 'Master',
    sidebarIcon: '🗂️',
    title: 'Master Module',
    subtitle: 'Schedules, accounts, items, users, godown & more',
    tileColor: '#2563eb',
    entry: true,
    items: masterMenuItemsForReportConfig(),
  },
  {
    id: 'utilities-module',
    index: 10,
    sidebarLabel: 'Utilities',
    sidebarIcon: '🔧',
    title: 'Utilities',
    subtitle: 'Year, transfers, installation & system tools',
    tileColor: '#6b7280',
    itemsSectionTitle: 'Options',
    entry: true,
    items: utilitiesMenuItemsForReportConfig(),
  },
  {
    id: 'income-tax-reports',
    index: 11,
    sidebarLabel: 'Income Tax',
    sidebarIcon: '📑',
    title: 'Income Tax Reports',
    subtitle: 'Party, item, monthly, cash & payment reports (VFP incometaxr menu)',
    tileColor: '#0f766e',
    itemsSectionTitle: 'Reports',
    entry: true,
    items: incomeTaxMenuItemsForReportConfig(),
  },
  {
    id: 'other-reports',
    index: 12,
    sidebarLabel: 'Other',
    sidebarIcon: '📂',
    title: 'Other Reports',
    subtitle: 'Labour, brokerage, chant, ledgers & outstanding (VFP otherreports menu)',
    tileColor: '#b45309',
    itemsSectionTitle: 'Reports',
    entry: true,
    items: otherReportsMenuItemsForReportConfig(),
  },
];

export const HOME_MODULE_ID = '__home__';

/** Shortcuts on Home — reports + A/c Master. */
export const QUICK_ACCESS = [
  { reportId: 'account-master', label: 'A/c Master', icon: '👤', color: '#2563eb' },
  { reportId: 'item-master', label: 'Item Master', icon: '📦', color: '#1d4ed8' },
  { reportId: 'trial-balance', label: 'Trial Balance', icon: '⚖️', color: '#0891b2' },
  { reportId: 'sale-list', label: 'Sale List', icon: '📑', color: '#b91c1c' },
  { reportId: 'sale-chart', label: 'Sale Chart', icon: '📈', color: '#0d9488' },
  { reportId: 'customer-ledger', label: 'Customer Ledger', icon: '👥', color: '#0284c7' },
  { reportId: 'overdue-customers', label: 'Overdue Customer', icon: '⏰', color: '#dc2626' },
  { reportId: 'ledger', label: 'Ledger', icon: '📒', color: '#4f46e5' },
  { reportId: 'stock-sum', label: 'Stock Summary', icon: '📦', color: '#ca8a04' },
  { reportId: 'stock-lot', label: 'Stock Lot', icon: '📊', color: '#d97706' },
  { reportId: 'gstr1', label: 'GSTR-1', icon: '📋', color: '#db2777' },
  { reportId: 'broker-os', label: 'Broker OS', icon: '🤝', color: '#7c3aed' },
];

export const FLAT_REPORT_ORDER = REPORT_MENU.flatMap((c) => c.items.map((i) => i.id));

export const REPORT_TO_CATEGORY = {
  ...Object.fromEntries(REPORT_MENU.flatMap((cat) => cat.items.map((item) => [item.id, cat.id]))),
  ...Object.fromEntries(
    ['sale-bill-printing', 'sale-list', 'sale-chart', ...saleTransactionMenuItemsForReportConfig().map((item) => item.id)]
      .map((id) => [id, 'sales-module'])
  ),
};

export function categoryForReport(reportId) {
  return REPORT_TO_CATEGORY[reportId] || REPORT_MENU[0].id;
}

export function findReportItem(reportId) {
  for (const cat of REPORT_MENU) {
    const item = cat.items.find((i) => i.id === reportId);
    if (item) return { ...item, category: cat };
  }
  return null;
}
