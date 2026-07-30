/**
 * GFASORCL Transaction module — from VFP BW_MENU popup transactio (menu/BW_MENU.MPR).
 * Live VFP: e:\gfasorcl\menu · forms · prg · reports
 */

import { GFASORCL_VFP_PATHS } from './gfasorclVfpPaths';
import {
  BANK_VOUCHER_ENTRY_SLIDE,
  CASH_VOUCHER_ENTRY_SLIDE,
  JOURNAL_VOUCHER_ENTRY_SLIDE,
} from './voucherEntryTypeConfig';

export const TRANSACTION_PLACEHOLDER_SLIDE = 92;
export const PURCHASE_ORDER_SLIDE = 97;
export const GOODS_INWARD_SLIDE = 98;
export const PURCHASE_BILL_SLIDE = 25;
export const BARDANA_PURCHASE_BILL_SLIDE = 100;
export const DEBIT_NOTE_SLIDE = 101;
export const EXP_VOUCHER_SLIDE = 102;
export const DEBIT_NOTE_OTHERS_SLIDE = 103;
export const CREDIT_NOTE_OTHERS_SLIDE = 104;
export const CONSIGNMENT_STOCK_SLIDE = 107;
export const SALES_ORDER_SLIDE = 108;
export const SALES_ORDER_HUB_SLIDE = 109;
export const DISPATCH_CHALLAN_SLIDE = 110;
export const DISPATCH_CHALLAN_HUB_SLIDE = 111;
export const SALES_RECORDS_HUB_SLIDE = 112;
export const SALE_BILL_SLIDE = 113;

/** Live voucher entry hubs (Add/Edit/Delete + related actions). */
export { CASH_VOUCHER_ENTRY_SLIDE, BANK_VOUCHER_ENTRY_SLIDE, JOURNAL_VOUCHER_ENTRY_SLIDE };

/** reportMenuConfig module id — restore this section when leaving a transaction screen. */
export const TRANSACTION_MENU_MODULE_ID = 'transaction-module';

export const VOUCHER_MENU_MODULE_ID = 'voucher-module';
export const PURCHASE_MENU_MODULE_ID = 'purchase-module';
export const SALES_MENU_MODULE_ID = 'sales-module';

/** Primary modules shown on the Sales landing screen. */
export const SALES_ROOT_MENU_ENTRY_IDS = ['sales-order', 'dispatch-challan', 'sales-records'];

/** Dispatch Challan child screens live under its Sales hub. */
export const DISPATCH_CHALLAN_HUB_ACTION_IDS = ['dispatch-challan-entry', 'dispatch-challan-return'];

/** VFP transactio popup groups shown under Vouchers in the web menu. */
export const VOUCHER_MENU_CATEGORIES = new Set([
  'cash-voucher',
  'bank-voucher',
  'journal-voucher',
  'journal-voucher-freight',
  'journal-voucher-extra',
  'bank-voucher-indent',
]);

/** Sales Order child screens live under the Sales Order hub, as in the VFP popup. */
export const SALES_ORDER_HUB_ACTION_IDS = [
  'sales-order-entry',
  'sales-order-checklist',
  'sales-order-pending',
  'sales-order-pending-detail',
  'sales-order-printing',
  'sales-order-pending-date-wise',
  'sales-order-pending-so-do-sale',
];

/** Sale / purchase tiles already covered by parent modules or legacy report ids. */
const SALE_MENU_EXCLUDE_IDS = new Set([
  'sale-bill-print-new-gst',
  'sale-bill-checklist',
  ...SALES_ROOT_MENU_ENTRY_IDS,
  ...SALES_ORDER_HUB_ACTION_IDS,
  ...DISPATCH_CHALLAN_HUB_ACTION_IDS,
  // Removed from Sales menu (empty VFP placeholders):
  'empty-truck-record',
  'gate-pass-entry',
  'gate-pass-checklist',
]);
const PURCHASE_MENU_EXCLUDE_IDS = new Set(['purchase-bill-checklist', 'purchase-bill-checklist-new']);

/** Purchase module menu — entry screens only (ordered). */
export const PURCHASE_MENU_ENTRY_IDS = [
  'purchase-order',
  'goods-inward-chalan',
  'purchase-bill-entry',
  'bardana-purchase-bill',
  'debit-note-entry',
  'purchase-voucher-other-items',
  'debit-note-others',
  'credit-note-others',
  'consignment-stock-entry',
];

/** Voucher module menu — entry hubs only (checklist is separate in reportMenuConfig). */
export const VOUCHER_MENU_ENTRY_IDS = [
  'cash-voucher-entry',
  'bank-voucher-entry',
  'journal-voucher-entry',
];

/** Voucher sub-screens opened from entry hubs — not listed separately in Vouchers menu. */
export const VOUCHER_MENU_EXCLUDE_IDS = new Set([
  'cash-voucher-checklist',
  'cash-voucher-printing',
  'cash-voucher-receipt-print',
  'cash-voucher-receipt-update',
  'cash-voucher-receipt-list',
  'cash-discount-list',
  'bank-voucher-checklist',
  'bank-voucher-printing',
  'bank-voucher-payment-received',
  'bank-voucher-rtgs-print',
  'bank-voucher-clearing-slip',
  'journal-voucher-checklist',
  'journal-voucher-printing',
  'journal-voucher-udaan-excel',
]);

/** Ordered action buttons on Cash Entry (VFP cashvouche popup bars 2–7). */
export const CASH_VOUCHER_HUB_ACTION_IDS = [
  'cash-voucher-checklist',
  'cash-voucher-printing',
  'cash-voucher-receipt-print',
  'cash-voucher-receipt-update',
  'cash-voucher-receipt-list',
  'cash-discount-list',
];

export const BANK_VOUCHER_HUB_ACTION_IDS = [
  'bank-voucher-checklist',
  'bank-voucher-printing',
  'bank-voucher-payment-received',
  'bank-voucher-rtgs-print',
  'bank-voucher-clearing-slip',
];

export const JOURNAL_VOUCHER_HUB_ACTION_IDS = [
  'journal-voucher-checklist',
  'journal-voucher-printing',
  'journal-voucher-udaan-excel',
];

const VOUCHER_HUB_ACTION_IDS_BY_ENTRY = {
  'cash-voucher-entry': CASH_VOUCHER_HUB_ACTION_IDS,
  'bank-voucher-entry': BANK_VOUCHER_HUB_ACTION_IDS,
  'journal-voucher-entry': JOURNAL_VOUCHER_HUB_ACTION_IDS,
};

export const TRANSACTION_CATEGORIES = [
  { id: 'cash-voucher', label: 'Cash Voucher' },
  { id: 'bank-voucher', label: 'Bank Voucher' },
  { id: 'journal-voucher', label: 'Journal Voucher' },
  { id: 'journal-voucher-freight', label: 'Journal Voucher Freight' },
  { id: 'journal-voucher-extra', label: 'Journal Voucher Extra' },
  { id: 'bank-voucher-indent', label: 'Bank Voucher Indent' },
  { id: 'purchase-records', label: 'Purchase Records' },
  { id: 'sale-records', label: 'Sale Records' },
  { id: 'production-records', label: 'Production Records' },
  { id: 'supplier-bikri', label: 'Supplier Bikri' },
  { id: 'customer-bikri', label: 'Customer Bikri' },
  { id: 'tds-voucher', label: 'TDS Voucher' },
  { id: 'bank-reconciliation', label: 'Bank Reconciliation' },
  { id: 'freight-voucher', label: 'Freight Voucher' },
  { id: 'reverse-charge', label: 'Reverse Charge' },
  { id: 'indent-voucher', label: 'Indent Voucher' },
];

/** @type {Array<{ id: string, category: string, title: string, shortTitle: string, description: string, vfpCommand: string, vfpFiles?: string[], vfpNote?: string, implemented?: boolean, slide?: number, defaultFormData?: Record<string, unknown> }>} */
export const TRANSACTION_MODULE_ITEMS = [
  // —— Cash Voucher ——
  {
    id: 'cash-voucher-entry',
    category: 'cash-voucher',
    title: 'Cash Voucher',
    shortTitle: 'Cash Voucher',
    description: 'Cash voucher entry (VFP DO FORM voucher CV)',
    vfpCommand: "DO FORM voucher WITH CTOD('  /  /    '),0,'CV',' ',''",
    vfpFiles: ['forms/voucher.scx', 'prg/voucher.prg'],
    vfpNote: 'F3',
    implemented: true,
    slide: CASH_VOUCHER_ENTRY_SLIDE,
  },
  {
    id: 'cash-voucher-checklist',
    category: 'cash-voucher',
    title: 'Cash Voucher — Checklist',
    shortTitle: 'Cash List',
    description: 'Cash voucher checklist (VFP vouchk CV)',
    vfpCommand: "DO FORM vouchk WITH 'CV'",
    vfpFiles: ['forms/vouchk.scx'],
    implemented: true,
    slide: 14,
    defaultFormData: { voucherVrType: 'CV' },
  },
  {
    id: 'cash-voucher-printing',
    category: 'cash-voucher',
    title: 'Cash Voucher — Printing',
    shortTitle: 'Cash Print',
    description: 'Print cash vouchers',
    vfpCommand: "DO FORM voupnt WITH CTOD('  /  /    '),0,'CV'",
    vfpFiles: ['forms/voupnt.scx'],
  },
  {
    id: 'cash-voucher-receipt-print',
    category: 'cash-voucher',
    title: 'Cash Voucher — Receipt Printing',
    shortTitle: 'Cash Receipt',
    description: 'Cash receipt printing',
    vfpCommand: "DO FORM receipt WITH CTOD('  /  /    '),0,'CV',''",
    vfpFiles: ['forms/receipt.scx'],
  },
  {
    id: 'cash-voucher-receipt-update',
    category: 'cash-voucher',
    title: 'Cash Voucher — Receipt Update',
    shortTitle: 'Receipt Upd',
    description: 'Update cash receipts',
    vfpCommand: 'DO FORM receipt_update',
    vfpFiles: ['forms/receipt_update.scx'],
  },
  {
    id: 'cash-voucher-receipt-list',
    category: 'cash-voucher',
    title: 'Cash Receipt List',
    shortTitle: 'Cash Rec List',
    description: 'Cash receipt list',
    vfpCommand: "DO FORM cashrecvd WITH 'CV'",
    vfpFiles: ['forms/cashrecvd.scx'],
  },
  {
    id: 'cash-discount-list',
    category: 'cash-voucher',
    title: 'Cash Discount List',
    shortTitle: 'Cash Disc',
    description: 'Cash discount list',
    vfpCommand: 'DO FORM CASHDIS',
    vfpFiles: ['forms/cashdis.scx'],
  },

  // —— Bank Voucher ——
  {
    id: 'bank-voucher-entry',
    category: 'bank-voucher',
    title: 'Bank Voucher',
    shortTitle: 'Bank Voucher',
    description: 'Bank voucher entry (VFP voucher BV)',
    vfpCommand: "DO FORM voucher WITH CTOD('  /  /    '),0,'BV',' ',''",
    vfpFiles: ['forms/voucher.scx'],
    vfpNote: 'F4',
    implemented: true,
    slide: BANK_VOUCHER_ENTRY_SLIDE,
  },
  {
    id: 'bank-voucher-checklist',
    category: 'bank-voucher',
    title: 'Bank Voucher — Checklist',
    shortTitle: 'Bank List',
    description: 'Bank voucher checklist',
    vfpCommand: "DO FORM vouchk WITH 'BV'",
    vfpFiles: ['forms/vouchk.scx'],
    implemented: true,
    slide: 14,
    defaultFormData: { voucherVrType: 'BV' },
  },
  {
    id: 'bank-voucher-printing',
    category: 'bank-voucher',
    title: 'Bank Voucher — Printing',
    shortTitle: 'Bank Print',
    description: 'Print bank vouchers',
    vfpCommand: "DO FORM voupnt WITH CTOD('  /  /    '),0,'BV'",
    vfpFiles: ['forms/voupnt.scx'],
  },
  {
    id: 'bank-voucher-payment-received',
    category: 'bank-voucher',
    title: 'Bank Voucher — Payment Received List',
    shortTitle: 'Bank Pmt List',
    description: 'Payment received list',
    vfpCommand: "DO FORM cashrecvd WITH 'BV'",
    vfpFiles: ['forms/cashrecvd.scx'],
  },
  {
    id: 'bank-voucher-rtgs-print',
    category: 'bank-voucher',
    title: 'Bank Voucher — RTGS Printing',
    shortTitle: 'RTGS Print',
    description: 'RTGS printing',
    vfpCommand: 'DO FORM rtgs WITH 1',
    vfpFiles: ['forms/rtgs.scx'],
  },
  {
    id: 'bank-voucher-clearing-slip',
    category: 'bank-voucher',
    title: 'Bank Voucher — Clearing Slip',
    shortTitle: 'Clearing',
    description: 'Bank clearing slip',
    vfpCommand: 'DO FORM rtgs WITH 2',
    vfpFiles: ['forms/rtgs.scx'],
  },

  // —— Journal Voucher ——
  {
    id: 'journal-voucher-entry',
    category: 'journal-voucher',
    title: 'Journal Voucher',
    shortTitle: 'Journal Voucher',
    description: 'Journal voucher entry',
    vfpCommand: "DO FORM voucher_JOURNAL WITH CTOD('  /  /    '),0,'JV',' ',''",
    vfpFiles: ['forms/voucher_journal.scx'],
    vfpNote: 'CTRL+F5',
    implemented: true,
    slide: JOURNAL_VOUCHER_ENTRY_SLIDE,
  },
  {
    id: 'journal-voucher-checklist',
    category: 'journal-voucher',
    title: 'Journal Voucher — Checklist',
    shortTitle: 'JV List',
    description: 'Journal voucher checklist',
    vfpCommand: "DO FORM vouchk WITH 'JV'",
    vfpFiles: ['forms/vouchk.scx'],
    implemented: true,
    slide: 14,
    defaultFormData: { voucherVrType: 'JV' },
  },
  {
    id: 'journal-voucher-printing',
    category: 'journal-voucher',
    title: 'Journal Voucher — Printing',
    shortTitle: 'JV Print',
    description: 'Print journal vouchers',
    vfpCommand: "DO FORM voupnt WITH CTOD('  /  /    '),0,'JV'",
    vfpFiles: ['forms/voupnt.scx'],
  },
  {
    id: 'journal-voucher-udaan-excel',
    category: 'journal-voucher',
    title: 'Journal Voucher — Udaan Excel File',
    shortTitle: 'Udaan Excel',
    description: 'Udaan Excel export',
    vfpCommand: 'DO FORM VOUCHER_UDAAN',
    vfpFiles: ['forms/voucher_udaan.scx'],
  },

  // —— Journal Voucher Freight ——
  {
    id: 'journal-freight-entry',
    category: 'journal-voucher-freight',
    title: 'Journal Voucher Freight — Add/Edit/Delete',
    shortTitle: 'JF Entry',
    description: 'Freight journal voucher entry',
    vfpCommand: "DO FORM voucher_freight WITH CTOD('  /  /    '),0,'JF',' ',''",
    vfpFiles: ['forms/voucher_freight.scx'],
  },
  {
    id: 'journal-freight-checklist',
    category: 'journal-voucher-freight',
    title: 'Journal Voucher Freight — Checklist',
    shortTitle: 'JF List',
    description: 'Freight journal checklist',
    vfpCommand: "DO FORM vouchk_freight WITH 'JF'",
    vfpFiles: ['forms/vouchk_freight.scx'],
  },

  // —— Journal Voucher Extra ——
  {
    id: 'journal-extra-entry',
    category: 'journal-voucher-extra',
    title: 'Journal Voucher Extra — Add/Edit/Delete',
    shortTitle: 'JE Entry',
    description: 'Extra journal voucher entry',
    vfpCommand: "DO FORM voucher_extra WITH CTOD('  /  /    '),0,'JE',' ',''",
    vfpFiles: ['forms/voucher_extra.scx'],
  },
  {
    id: 'journal-extra-checklist',
    category: 'journal-voucher-extra',
    title: 'Journal Voucher Extra — Checklist',
    shortTitle: 'JE List',
    description: 'Extra journal checklist',
    vfpCommand: "DO FORM vouchk WITH 'JE'",
    vfpFiles: ['forms/vouchk.scx'],
    implemented: true,
    slide: 14,
    defaultFormData: { voucherVrType: 'JE' },
  },

  // —— Bank Voucher Indent ——
  {
    id: 'bank-indent-entry',
    category: 'bank-voucher-indent',
    title: 'Bank Voucher Indent — Add/Edit/Delete',
    shortTitle: 'BI Entry',
    description: 'Bank indent voucher entry',
    vfpCommand: "DO FORM voucher WITH CTOD('  /  /    '),0,'BI',' ',''",
    vfpFiles: ['forms/voucher.scx'],
  },
  {
    id: 'bank-indent-checklist',
    category: 'bank-voucher-indent',
    title: 'Bank Voucher Indent — Checklist',
    shortTitle: 'BI List',
    description: 'Bank indent checklist',
    vfpCommand: "DO FORM vouchk WITH 'BI'",
    vfpFiles: ['forms/vouchk.scx'],
    implemented: true,
    slide: 14,
    defaultFormData: { voucherVrType: 'BI' },
  },
  {
    id: 'bank-indent-printing',
    category: 'bank-voucher-indent',
    title: 'Bank Voucher Indent — Printing',
    shortTitle: 'BI Print',
    description: 'Print bank indent vouchers',
    vfpCommand: "DO FORM voupnt WITH CTOD('  /  /    '),0,'BI'",
    vfpFiles: ['forms/voupnt.scx'],
  },

  // —— Purchase Records ——
  {
    id: 'purchase-order',
    category: 'purchase-records',
    title: 'Purchase Order Records',
    shortTitle: 'Purchase Order',
    description: 'Purchase order entry',
    vfpCommand: "DO FORM PORDER WITH 'SO'",
    vfpFiles: ['forms/porder.scx'],
    implemented: true,
    slide: PURCHASE_ORDER_SLIDE,
  },
  {
    id: 'goods-inward-chalan',
    category: 'purchase-records',
    title: 'Goods Inward Notes',
    shortTitle: 'Goods Inward Notes',
    description: 'Goods inward notes',
    vfpCommand: "DO FORM inward WITH 'IN',G_BLNKDT,0",
    vfpFiles: ['forms/inward.scx'],
    implemented: true,
    slide: GOODS_INWARD_SLIDE,
  },
  {
    id: 'consignment-stock-entry',
    category: 'purchase-records',
    title: 'Consignment Stock Entry',
    shortTitle: 'Consignment Stock Entry',
    description: 'Consignment stock entry',
    vfpCommand: "DO FORM cstock WITH 'PC',G_BLNKDT,0,''",
    vfpFiles: ['forms/cstock.scx'],
    vfpNote: 'F5',
    implemented: true,
    slide: CONSIGNMENT_STOCK_SLIDE,
  },
  {
    id: 'consignment-stock-checklist',
    category: 'purchase-records',
    title: 'Consignment Stock Entry — Checklist',
    shortTitle: 'Consign List',
    description: 'Consignment stock checklist',
    vfpCommand: 'DO FORM cschk',
    vfpFiles: ['forms/cschk.scx'],
    implemented: true,
    slide: CONSIGNMENT_STOCK_SLIDE,
    defaultFormData: { openCstockChecklist: true },
  },
  {
    id: 'purchase-bill-entry',
    category: 'purchase-records',
    title: 'Purchase Bill',
    shortTitle: 'Purchase Bill',
    description: 'Purchase bill entry',
    vfpCommand: "DO FORM &G_PURCHASE_FORM WITH 'PU',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/purchase.scx', 'forms/purchase_gst.scx'],
    vfpNote: 'F6',
    implemented: true,
    slide: PURCHASE_BILL_SLIDE,
  },
  {
    id: 'purchase-bill-checklist',
    category: 'purchase-records',
    title: 'Purchase Bill — Checklist',
    shortTitle: 'Pur List',
    description: 'Purchase bill checklist',
    vfpCommand: "DO FORM pbchk WITH 'PU',1",
    vfpFiles: ['forms/pbchk.scx'],
    implemented: true,
    slide: 11,
  },
  {
    id: 'purchase-bill-checklist-new',
    category: 'purchase-records',
    title: 'Purchase Bill — Checklist New',
    shortTitle: 'Pur List New',
    description: 'Purchase checklist (new format)',
    vfpCommand: "DO FORM pbchk WITH 'PU',2",
    vfpFiles: ['forms/pbchk.scx'],
    implemented: true,
    slide: 11,
  },
  {
    id: 'purchase-bill-checklist-gst',
    category: 'purchase-records',
    title: 'Purchase Bill — Checklist GST',
    shortTitle: 'Pur GST List',
    description: 'Purchase GST checklist',
    vfpCommand: "DO FORM pbchk WITH 'PU',3",
    vfpFiles: ['forms/pbchk.scx'],
  },
  {
    id: 'purchase-bill-expenses-list',
    category: 'purchase-records',
    title: 'Purchase Bill — Expenses List',
    shortTitle: 'Pur Exp List',
    description: 'Purchase expenses list',
    vfpCommand: "DO FORM pbchk WITH 'PU',4",
    vfpFiles: ['forms/pbchk.scx'],
  },
  {
    id: 'purchase-code-wise-report',
    category: 'purchase-records',
    title: 'Purchase Code Wise Report',
    shortTitle: 'Pur Code Rpt',
    description: 'Purchase by account code',
    vfpCommand: "DO FORM PBCHK_PUR_CODE WITH 'PU'",
    vfpFiles: ['forms/pbchk_pur_code.scx'],
  },
  {
    id: 'purchase-date-diff',
    category: 'purchase-records',
    title: 'Purchase Date Diff',
    shortTitle: 'Pur Date Diff',
    description: 'Purchase date difference report',
    vfpCommand: 'DO FORM misc_utl WITH 1',
    vfpFiles: ['forms/misc_utl.scx'],
  },
  {
    id: 'purchase-weight-diff',
    category: 'purchase-records',
    title: 'Purchase Weight Diff',
    shortTitle: 'Pur Wgt Diff',
    description: 'Purchase weight difference',
    vfpCommand: 'DO FORM misc_utl WITH 2',
    vfpFiles: ['forms/misc_utl.scx'],
  },
  {
    id: 'purchase-update-file-path',
    category: 'purchase-records',
    title: 'Purchase Bill — Update File Path',
    shortTitle: 'Pur File Path',
    description: 'Update purchase bill file path',
    vfpCommand: 'DO FORM update_purchase_BILL_file_path',
    vfpFiles: ['forms/update_purchase_bill_file_path.scx'],
  },
  {
    id: 'purchase-bill-checklist-short',
    category: 'purchase-records',
    title: 'Purchase Bill — Checklist Short',
    shortTitle: 'Pur Short',
    description: 'Short purchase checklist',
    vfpCommand: "DO FORM pbchk WITH 'PU',5",
    vfpFiles: ['forms/pbchk.scx'],
  },
  {
    id: 'bardana-purchase-bill',
    category: 'purchase-records',
    title: 'Purchase Bill Bardana',
    shortTitle: 'Purchase Bill Bardana',
    description: 'Bardana purchase bill (VFP purchase_bardana / TYPE PB)',
    vfpCommand: "DO FORM PURCHASE_bardana WITH 'PB',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/purchase_bardana.scx'],
    implemented: true,
    slide: BARDANA_PURCHASE_BILL_SLIDE,
  },
  {
    id: 'debit-note-entry',
    category: 'purchase-records',
    title: 'Debit Note',
    shortTitle: 'Debit Note',
    description: 'Purchase debit note (TYPE DN) — pick PU bill lines after supplier',
    vfpCommand: "DO FORM &G_PURCHASE_FORM WITH 'DN',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/purchase_gst.scx', 'forms/purchase.scx'],
    implemented: true,
    slide: DEBIT_NOTE_SLIDE,
  },
  {
    id: 'debit-note-checklist',
    category: 'purchase-records',
    title: 'Debit Note — Checklist',
    shortTitle: 'DN List',
    description: 'Debit note checklist',
    vfpCommand: "DO FORM pbchk WITH 'DN',3",
    vfpFiles: ['forms/pbchk.scx'],
  },
  {
    id: 'purchase-voucher-other-items',
    category: 'purchase-records',
    title: 'Purchase Other Items',
    shortTitle: 'Purchase Other Items',
    description: 'Other purchase voucher items',
    vfpCommand: "DO FORM EXPVOU WITH 'EV',CTOD('  /  /    '),0",
    vfpFiles: ['forms/expvou.scx'],
    implemented: true,
    slide: EXP_VOUCHER_SLIDE,
  },
  {
    id: 'purchase-voucher-other-checklist',
    category: 'purchase-records',
    title: 'Purchase Voucher Other Items — Checklist',
    shortTitle: 'Pur Other List',
    description: 'Other purchase voucher checklist',
    vfpCommand: "DO FORM EXPVOU_CHK WITH 'EV'",
    vfpFiles: ['forms/expvou_chk.scx'],
  },
  {
    id: 'purchase-voucher-update-bill-path',
    category: 'purchase-records',
    title: 'Purchase Voucher — Update Bill File Path',
    shortTitle: 'Pur Vou Path',
    description: 'Update bill file path on purchase voucher',
    vfpCommand: 'DO FORM update_purchase_bill_file_path',
    vfpFiles: ['forms/update_purchase_bill_file_path.scx'],
  },
  {
    id: 'import-goods-sauda-entry',
    category: 'purchase-records',
    title: 'Import Goods Sauda — Add/Edit/Delete',
    shortTitle: 'Import Sauda',
    description: 'Import goods sauda entry',
    vfpCommand: 'DO FORM impoadd',
    vfpFiles: ['forms/impoadd.scx'],
  },
  {
    id: 'import-goods-sauda-checklist',
    category: 'purchase-records',
    title: 'Import Goods Sauda — Checklist',
    shortTitle: 'Import List',
    description: 'Import goods checklist',
    vfpCommand: 'DO FORM impochk',
    vfpFiles: ['forms/impochk.scx'],
  },
  {
    id: 'import-goods-sauda-printing',
    category: 'purchase-records',
    title: 'Import Goods Sauda — Printing',
    shortTitle: 'Import Print',
    description: 'Import goods printing',
    vfpCommand: 'DO FORM impopnt',
    vfpFiles: ['forms/impopnt.scx'],
  },
  {
    id: 'debit-note-others',
    category: 'purchase-records',
    title: 'Debit Note Others',
    shortTitle: 'Debit Note Others',
    description: 'Other debit note (VFP DCNOTE TYPE DX)',
    vfpCommand: "DO FORM DCNOTE WITH 'DX',G_BLNKDT,0",
    vfpFiles: ['forms/dcnote.scx'],
    implemented: true,
    slide: DEBIT_NOTE_OTHERS_SLIDE,
  },
  {
    id: 'credit-note-others',
    category: 'purchase-records',
    title: 'Credit Note Others',
    shortTitle: 'Credit Note Others',
    description: 'Other credit note (VFP DCNOTE TYPE CX)',
    vfpCommand: "DO FORM DCNOTE WITH 'CX',G_BLNKDT,0",
    vfpFiles: ['forms/dcnote.scx'],
    implemented: true,
    slide: CREDIT_NOTE_OTHERS_SLIDE,
  },
  {
    id: 'tcs-debit-note-auto',
    category: 'purchase-records',
    title: 'TCS Debit Note Auto',
    shortTitle: 'TCS DN Auto',
    description: 'Auto TCS debit note',
    vfpCommand: 'DO FORM tcs_dnote_auto',
    vfpFiles: ['forms/tcs_dnote_auto.scx'],
  },

  // —— Sale Records ——
  {
    id: 'sales-records',
    category: 'sale-records',
    title: 'Sales',
    shortTitle: 'Sales',
    description: 'Sale bills, printing, reports and other sale options',
    vfpCommand: 'Sale Records popup',
    vfpFiles: ['menu/BW_MENU.MPR'],
    implemented: true,
    slide: SALES_RECORDS_HUB_SLIDE,
  },
  {
    id: 'sales-order',
    category: 'sale-records',
    title: 'Sales Order Records',
    shortTitle: 'Sales Order',
    description: 'Sales order entry, checklist, pending reports and printing',
    vfpCommand: 'Sales Order popup',
    vfpFiles: ['forms/sorder.scx', 'forms/sochk.scx', 'forms/sopnd.scx', 'forms/sopnt.scx'],
    implemented: true,
    slide: SALES_ORDER_HUB_SLIDE,
  },
  {
    id: 'sales-order-entry',
    category: 'sale-records',
    title: 'Sales Order — Add/Edit/Delete',
    shortTitle: 'SO Entry',
    description: 'Sales order entry',
    vfpCommand: "DO FORM SORDER WITH 'SO'",
    vfpFiles: ['forms/sorder.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
  },
  {
    id: 'sales-order-checklist',
    category: 'sale-records',
    title: 'Sales Order — Checklist',
    shortTitle: 'SO List',
    description: 'Sales order checklist',
    vfpCommand: "DO FORM sochk WITH 'SO'",
    vfpFiles: ['forms/sochk.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
    defaultFormData: { openSoChecklist: true },
  },
  {
    id: 'sales-order-pending',
    category: 'sale-records',
    title: 'Sales Order — Pending',
    shortTitle: 'SO Pending',
    description: 'Pending sales orders',
    vfpCommand: 'DO FORM sopnd WITH 1',
    vfpFiles: ['forms/sopnd.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
    defaultFormData: { openSoPending: 'summary' },
  },
  {
    id: 'sales-order-pending-detail',
    category: 'sale-records',
    title: 'Sales Order — Pending Detail',
    shortTitle: 'SO Pend Det',
    description: 'Pending sales order detail',
    vfpCommand: 'DO FORM sopnd WITH 2',
    vfpFiles: ['forms/sopnd.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
    defaultFormData: { openSoPending: 'detail' },
  },
  {
    id: 'sales-order-printing',
    category: 'sale-records',
    title: 'Sales Order — Printing',
    shortTitle: 'SO Print',
    description: 'Print sales orders',
    vfpCommand: "DO FORM sopnt WITH 'SO',0,0",
    vfpFiles: ['forms/sopnt.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
    defaultFormData: { openSoPrint: true },
  },
  {
    id: 'sales-order-pending-date-wise',
    category: 'sale-records',
    title: 'Sales Order — Pending List Date Wise',
    shortTitle: 'SO Pend Date',
    description: 'Date-wise pending sales orders',
    vfpCommand: 'DO FORM sopnd WITH 3',
    vfpFiles: ['forms/sopnd.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
    defaultFormData: { openSoPending: 'date-wise' },
  },
  {
    id: 'sales-order-pending-so-do-sale',
    category: 'sale-records',
    title: 'Sales Order — Pending SO/DO/Sale',
    shortTitle: 'SO/DO/Sale',
    description: 'Pending SO, DO and sale',
    vfpCommand: 'DO FORM sopnd WITH 4',
    vfpFiles: ['forms/sopnd.scx'],
    implemented: true,
    slide: SALES_ORDER_SLIDE,
    defaultFormData: { openSoPending: 'so-do-sale' },
  },
  {
    id: 'empty-truck-record',
    category: 'sale-records',
    title: 'Empty Truck Record',
    shortTitle: 'Empty Truck',
    description: 'Outward empty truck records',
    vfpCommand: 'DO FORM outward_empty_truck_records',
    vfpFiles: ['forms/outward_empty_truck_records.scx'],
  },
  {
    id: 'gate-pass-entry',
    category: 'sale-records',
    title: 'Gate Pass — Add/Edit/Delete',
    shortTitle: 'Gate Pass',
    description: 'Gate pass entry',
    vfpCommand: "DO FORM inward WITH 'OU',G_BLNKDT,0",
    vfpFiles: ['forms/inward.scx'],
  },
  {
    id: 'gate-pass-checklist',
    category: 'sale-records',
    title: 'Gate Pass — Checklist',
    shortTitle: 'Gate List',
    description: 'Gate pass checklist',
    vfpCommand: "DO FORM inward_CHK WITH 'OU'",
    vfpFiles: ['forms/inward_chk.scx'],
  },
  {
    id: 'dispatch-challan',
    category: 'sale-records',
    title: 'Dispatch Challan',
    shortTitle: 'Dispatch Challan',
    description: 'Dispatch challan and DC return',
    vfpCommand: 'Dispatch Challan popup',
    vfpFiles: ['forms/dcadd.scx'],
    vfpNote: 'CTRL+F6',
    implemented: true,
    slide: DISPATCH_CHALLAN_HUB_SLIDE,
  },
  {
    id: 'dispatch-challan-entry',
    category: 'sale-records',
    title: 'Dispatch Challan — Add/Edit/Delete',
    shortTitle: 'Dispatch',
    description: 'Dispatch challan entry',
    vfpCommand: "DO FORM dcadd WITH 'DC',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/dcadd.scx'],
    vfpNote: 'CTRL+F6',
    implemented: true,
    slide: DISPATCH_CHALLAN_SLIDE,
    defaultFormData: { dcType: 'DC' },
  },
  {
    id: 'dispatch-challan-return',
    category: 'sale-records',
    title: 'Dispatch Challan Return',
    shortTitle: 'DC Return',
    description: 'Dispatch challan return',
    vfpCommand: "DO FORM dcadd WITH 'DR',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/dcadd.scx'],
    implemented: true,
    slide: DISPATCH_CHALLAN_SLIDE,
    defaultFormData: { dcType: 'DR' },
  },
  {
    id: 'sale-bill-entry',
    category: 'sale-records',
    title: 'Sale Bill — Add/Edit/Delete',
    shortTitle: 'Sale Bill',
    description: 'Sale bill entry',
    vfpCommand: "DO FORM &G_SALE_FORM WITH 'SL',CTOD('  /  /    '),0,'','N'",
    vfpFiles: ['forms/sale.scx', 'forms/sale_gst.scx'],
    implemented: true,
    slide: SALE_BILL_SLIDE,
    vfpNote: 'F2',
  },
  {
    id: 'sale-bill-checklist',
    category: 'sale-records',
    title: 'Sale Bill — Checklist',
    shortTitle: 'Sale List',
    description: 'Sale bill checklist',
    vfpCommand: "DO FORM salechk WITH 'SL',1",
    vfpFiles: ['forms/salechk.scx'],
    implemented: true,
    slide: 8,
    vfpNote: 'ALT+F2',
  },
  {
    id: 'sale-bill-print-old',
    category: 'sale-records',
    title: 'Sale Bill — Printing Old Before GST',
    shortTitle: 'Sale Old Print',
    description: 'Pre-GST sale bill printing',
    vfpCommand: "DO FORM salepnt WITH 'SL',0,0,'N',1",
    vfpFiles: ['forms/salepnt.scx'],
  },
  {
    id: 'sale-bill-print-new-gst',
    category: 'sale-records',
    title: 'Sale Bill — Printing New With GST',
    shortTitle: 'Sale Print',
    description: 'GST sale bill printing',
    vfpCommand: "DO FORM salepnt_Gst WITH 'SL',G_SDATE,G_EDATE,0,0,'N',1,''",
    vfpFiles: ['forms/salepnt_gst.scx'],
    implemented: true,
    slide: 13,
  },
  {
    id: 'sale-bill-marka-wise',
    category: 'sale-records',
    title: 'Sale Bill — Marka Wise Sale',
    shortTitle: 'Marka Sale',
    description: 'Marka-wise sale report',
    vfpCommand: 'DO FORM markasale',
    vfpFiles: ['forms/markasale.scx'],
  },
  {
    id: 'sale-bill-gatepass-print',
    category: 'sale-records',
    title: 'Sale Bill — Gatepass Printing',
    shortTitle: 'Gate Print',
    description: 'Gatepass printing from sale',
    vfpCommand: "DO FORM gatepnt WITH 'SL',0,0,'N'",
    vfpFiles: ['forms/gatepnt.scx'],
  },
  {
    id: 'sale-bill-weight-diff',
    category: 'sale-records',
    title: 'Sale Bill — Weight Diff Report',
    shortTitle: 'Sale Wgt Diff',
    description: 'Sale weight difference',
    vfpCommand: 'DO FORM wgtdif',
    vfpFiles: ['forms/wgtdif.scx'],
  },
  {
    id: 'sale-bill-checklist-diff',
    category: 'sale-records',
    title: 'Sale Bill — Checklist Diff Format',
    shortTitle: 'Sale Diff List',
    description: 'Sale checklist diff format',
    vfpCommand: "DO FORM salechk WITH 'SL',2",
    vfpFiles: ['forms/salechk.scx'],
  },
  {
    id: 'sale-bill-gst-checklist',
    category: 'sale-records',
    title: 'Sale Bill — GST Checklist',
    shortTitle: 'Sale GST List',
    description: 'GST sale checklist',
    vfpCommand: "DO FORM salechk WITH 'SL',3",
    vfpFiles: ['forms/salechk.scx'],
  },
  {
    id: 'sale-bill-gst-checklist-2',
    category: 'sale-records',
    title: 'Sale Bill — GST Checklist 2',
    shortTitle: 'Sale GST 2',
    description: 'GST sale checklist format 2',
    vfpCommand: "DO FORM salechk WITH 'SL',4",
    vfpFiles: ['forms/salechk.scx'],
  },
  {
    id: 'sale-bill-truck-feeding',
    category: 'sale-records',
    title: 'Sale Bill — Truck No. Feeding',
    shortTitle: 'Truck Feed',
    description: 'Feed truck numbers on sale bills',
    vfpCommand: 'DO FORM purchase_bilty',
    vfpFiles: ['forms/purchase_bilty.scx'],
  },
  {
    id: 'sale-bill-eway-feeding',
    category: 'sale-records',
    title: 'Sale Bill — Eway No. Feeding',
    shortTitle: 'Eway Feed',
    description: 'Feed e-way bill numbers',
    vfpCommand: 'DO FORM sale_eway',
    vfpFiles: ['forms/sale_eway.scx'],
  },
  {
    id: 'sale-bill-checklist-supplier',
    category: 'sale-records',
    title: 'Sale Bill — Checklist Supplier',
    shortTitle: 'Sale Sup List',
    description: 'Supplier-wise sale checklist',
    vfpCommand: "DO FORM salechk_sup WITH 'SL'",
    vfpFiles: ['forms/salechk_sup.scx'],
  },
  {
    id: 'sale-bill-udaan-excel',
    category: 'sale-records',
    title: 'Sale Bill — Udaan Excel File',
    shortTitle: 'Sale Udaan',
    description: 'Udaan Excel export from sales',
    vfpCommand: 'DO FORM sale_udaan',
    vfpFiles: ['forms/sale_udaan.scx'],
  },
  {
    id: 'sale-bill-supplier-wise-report',
    category: 'sale-records',
    title: 'Sale Bill — Supplier Wise Report',
    shortTitle: 'Sale Sup Rpt',
    description: 'Supplier-wise sale report',
    vfpCommand: "DO FORM pbchk_pur_code WITH 'SL'",
    vfpFiles: ['forms/pbchk_pur_code.scx'],
  },
  {
    id: 'sale-bill-amazon-file',
    category: 'sale-records',
    title: 'Sale Bill — Amazon Sale File',
    shortTitle: 'Amazon Sale',
    description: 'Amazon sale file export',
    vfpCommand: 'DO FORM sale_amazon',
    vfpFiles: ['forms/sale_amazon.scx'],
  },
  {
    id: 'sale-bill-update-einv-irn',
    category: 'sale-records',
    title: 'Sale Bill — Update E-Inv IRN No.',
    shortTitle: 'Update IRN',
    description: 'Update e-invoice IRN numbers',
    vfpCommand: 'DO FORM sale_einv_update_irn_no',
    vfpFiles: ['forms/sale_einv_update_irn_no.scx'],
  },
  {
    id: 'sale-bill-gw-nw-diff',
    category: 'sale-records',
    title: 'Sale Bill — GW/NW Diff',
    shortTitle: 'GW/NW Diff',
    description: 'Gross/net weight difference on sales',
    vfpCommand: 'DO FORM misc_utl WITH 3',
    vfpFiles: ['forms/misc_utl.scx'],
  },
  {
    id: 'sale-bill-find-eway',
    category: 'sale-records',
    title: 'Sale Bill — Find Eway No.',
    shortTitle: 'Find Eway',
    description: 'Find e-way bill number',
    vfpCommand: 'DO FORM sale_eway_find',
    vfpFiles: ['forms/sale_eway_find.scx'],
  },
  {
    id: 'sale-bill-find-einv-irn',
    category: 'sale-records',
    title: 'Sale Bill — Find E-Inv IRN No.',
    shortTitle: 'Find IRN',
    description: 'Find e-invoice IRN',
    vfpCommand: 'DO FORM sale_einv_find',
    vfpFiles: ['forms/sale_einv_find.scx'],
  },
  {
    id: 'sale-bill-eway-closure',
    category: 'sale-records',
    title: 'Sale Bill — Eway Closure',
    shortTitle: 'Eway Close',
    description: 'Close e-way bills',
    vfpCommand: 'DO FORM sale_eway_close',
    vfpFiles: ['forms/sale_eway_close.scx'],
  },
  {
    id: 'sale-return',
    category: 'sale-records',
    title: 'Sale Return',
    shortTitle: 'Sale Return',
    description: 'Sale return entry',
    vfpCommand: "DO FORM cnadd WITH 'CN',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/cnadd.scx'],
  },
  {
    id: 'export-chalan-entry',
    category: 'sale-records',
    title: 'Export Chalan — Add/Edit/Delete',
    shortTitle: 'Exp Chalan',
    description: 'Export dispatch chalan',
    vfpCommand: "DO FORM dcadd WITH 'EC',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/dcadd.scx'],
  },
  {
    id: 'export-chalan-checklist',
    category: 'sale-records',
    title: 'Export Chalan — Checklist',
    shortTitle: 'Exp Ch List',
    description: 'Export chalan checklist',
    vfpCommand: "DO FORM dcchk WITH 'EC'",
    vfpFiles: ['forms/dcchk.scx'],
  },
  {
    id: 'export-sale-bill-entry',
    category: 'sale-records',
    title: 'Export Sale Bill — Add/Edit/Delete',
    shortTitle: 'Exp Sale',
    description: 'Export sale bill entry',
    vfpCommand: "DO FORM sale_EXP WITH 'SE',CTOD('  /  /    '),0,'','E'",
    vfpFiles: ['forms/sale_exp.scx'],
  },
  {
    id: 'export-sale-bill-checklist',
    category: 'sale-records',
    title: 'Export Sale Bill — Checklist',
    shortTitle: 'Exp Sale List',
    description: 'Export sale checklist',
    vfpCommand: "DO FORM salechk_exp WITH 'SE'",
    vfpFiles: ['forms/salechk_exp.scx'],
  },
  {
    id: 'export-sale-return-entry',
    category: 'sale-records',
    title: 'Export Sale Return — Add/Edit/Delete',
    shortTitle: 'Exp Return',
    description: 'Export sale return entry',
    vfpCommand: "DO FORM sale_EXP WITH 'ER',CTOD('  /  /    '),0,'','E'",
    vfpFiles: ['forms/sale_exp.scx'],
  },
  {
    id: 'export-sale-return-checklist',
    category: 'sale-records',
    title: 'Export Sale Return — Checklist',
    shortTitle: 'Exp Ret List',
    description: 'Export sale return checklist',
    vfpCommand: "DO FORM salechk_exp WITH 'ER'",
    vfpFiles: ['forms/salechk_exp.scx'],
  },
  {
    id: 'consignment-challan',
    category: 'sale-records',
    title: 'Consignment Challan',
    shortTitle: 'Consign CH',
    description: 'Consignment challan entry',
    vfpCommand: "DO FORM chadd WITH 'CH',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/chadd.scx'],
  },
  {
    id: 'consignment-stock-return',
    category: 'sale-records',
    title: 'Consignment Stock Return',
    shortTitle: 'Consign Ret',
    description: 'Consignment stock return',
    vfpCommand: "DO FORM csadd WITH 'CS',CTOD('  /  /    '),0,''",
    vfpFiles: ['forms/csadd.scx'],
  },
  {
    id: 'consignment-challan-return',
    category: 'sale-records',
    title: 'Consignment Challan Return',
    shortTitle: 'Consign CH Ret',
    description: 'Consignment challan return',
    vfpCommand: "DO FORM CCADD WITH 'CC',G_BLNKDT,0,''",
    vfpFiles: ['forms/ccadd.scx'],
  },
  {
    id: 'job-work-sale-bill',
    category: 'sale-records',
    title: 'Job Work Sale Bill',
    shortTitle: 'Job Sale',
    description: 'Job work sale bill',
    vfpCommand: "DO FORM JOBBILL WITH 'JB',G_BLNKDT,0",
    vfpFiles: ['forms/jobbill.scx'],
  },
  {
    id: 'sale-other-item',
    category: 'sale-records',
    title: 'Sale Other Item',
    shortTitle: 'Sale Other',
    description: 'Sale of other items',
    vfpCommand: "DO FORM SALE_EXTRA WITH 'SX',CTOD('  /  /    '),0,'','N'",
    vfpFiles: ['forms/sale_extra.scx'],
    vfpNote: 'ALT+F3',
  },
  {
    id: 'performa-invoice',
    category: 'sale-records',
    title: 'Performa Invoice',
    shortTitle: 'Performa',
    description: 'Performa invoice entry',
    vfpCommand: "DO FORM PISALE WITH 'SL',CTOD('  /  /    '),0,'','N'",
    vfpFiles: ['forms/pisale.scx'],
  },
  {
    id: 'performa-invoice-export',
    category: 'sale-records',
    title: 'Performa Invoice Export',
    shortTitle: 'Performa Exp',
    description: 'Export performa invoice',
    vfpCommand: "DO FORM PIsale_EXP WITH 'SL',CTOD('  /  /    '),0,'','E'",
    vfpFiles: ['forms/pisale_exp.scx'],
  },

  // —— Production Records ——
  {
    id: 'stock-convert-issue-entry',
    category: 'production-records',
    title: 'Stock Convert Issue — Add/Edit/Delete',
    shortTitle: 'Stk Issue',
    description: 'Stock conversion issue',
    vfpCommand: "DO FORM PROD WITH 'I',G_BLNKDT,0,''",
    vfpFiles: ['forms/prod.scx'],
  },
  {
    id: 'stock-convert-issue-list',
    category: 'production-records',
    title: 'Stock Convert Issue — List',
    shortTitle: 'Stk Issue List',
    description: 'Stock issue list',
    vfpCommand: "DO FORM prodchk WITH 'I'",
    vfpFiles: ['forms/prodchk.scx'],
  },
  {
    id: 'stock-convert-received-entry',
    category: 'production-records',
    title: 'Stock Convert Received — Add/Edit/Delete',
    shortTitle: 'Stk Recvd',
    description: 'Stock conversion received',
    vfpCommand: "DO FORM prodr WITH 'R',G_BLNKDT,0,''",
    vfpFiles: ['forms/prodr.scx'],
  },
  {
    id: 'stock-convert-received-list',
    category: 'production-records',
    title: 'Stock Convert Received — List',
    shortTitle: 'Stk Rec List',
    description: 'Stock received list',
    vfpCommand: "DO FORM prodchk WITH 'R'",
    vfpFiles: ['forms/prodchk.scx'],
  },
  {
    id: 'jobwork-issue-entry',
    category: 'production-records',
    title: 'Jobwork/Stock Trf Issue — Add/Edit/Delete',
    shortTitle: 'JW Issue',
    description: 'Jobwork stock transfer issue',
    vfpCommand: "DO FORM JOBWORK WITH 'JI',G_BLNKDT,0,''",
    vfpFiles: ['forms/jobwork.scx'],
  },
  {
    id: 'jobwork-issue-list',
    category: 'production-records',
    title: 'Jobwork/Stock Trf Issue — List',
    shortTitle: 'JW Issue List',
    description: 'Jobwork issue list',
    vfpCommand: "DO FORM jobchk WITH 'JI'",
    vfpFiles: ['forms/jobchk.scx'],
  },
  {
    id: 'jobwork-stock',
    category: 'production-records',
    title: 'Jobwork Stock',
    shortTitle: 'JW Stock',
    description: 'Jobwork stock report',
    vfpCommand: 'DO FORM jobstk',
    vfpFiles: ['forms/jobstk.scx'],
  },
  {
    id: 'jobwork-received-entry',
    category: 'production-records',
    title: 'Jobwork Received — Add/Edit/Delete',
    shortTitle: 'JW Recvd',
    description: 'Jobwork received entry',
    vfpCommand: "DO FORM jobwork WITH 'JR',G_BLNKDT,0,''",
    vfpFiles: ['forms/jobwork.scx'],
  },
  {
    id: 'jobwork-received-list',
    category: 'production-records',
    title: 'Jobwork Received — List',
    shortTitle: 'JW Rec List',
    description: 'Jobwork received list',
    vfpCommand: "DO FORM jobchk WITH 'JR'",
    vfpFiles: ['forms/jobchk.scx'],
  },
  {
    id: 'dharra-entry',
    category: 'production-records',
    title: 'Dharra Records — Add/Edit/Delete',
    shortTitle: 'Dharra',
    description: 'Dharra production entry',
    vfpCommand: "DO FORM dharra WITH 'D',G_BLNKDT,0,''",
    vfpFiles: ['forms/dharra.scx'],
    vfpNote: 'CTRL+F9',
  },
  {
    id: 'dharra-list',
    category: 'production-records',
    title: 'Dharra Records — List',
    shortTitle: 'Dharra List',
    description: 'Dharra records list',
    vfpCommand: 'DO FORM dharrachk',
    vfpFiles: ['forms/dharrachk.scx'],
    vfpNote: 'CTRL+F11',
  },
  {
    id: 'cold-store-issue',
    category: 'production-records',
    title: 'Cold Store — Issue Add/Edit/Delete',
    shortTitle: 'Cold Issue',
    description: 'Cold store issue entry',
    vfpCommand: "DO FORM coldADD WITH 'CI'",
    vfpFiles: ['forms/coldadd.scx'],
  },
  {
    id: 'cold-store-received',
    category: 'production-records',
    title: 'Cold Store — Received Add/Edit/Delete',
    shortTitle: 'Cold Recvd',
    description: 'Cold store received entry',
    vfpCommand: "DO FORM coldadd WITH 'CR'",
    vfpFiles: ['forms/coldadd.scx'],
  },
  {
    id: 'cold-store-checklist',
    category: 'production-records',
    title: 'Cold Store — Checklist',
    shortTitle: 'Cold List',
    description: 'Cold store checklist',
    vfpCommand: 'DO FORM coldchk WITH 1',
    vfpFiles: ['forms/coldchk.scx'],
  },
  {
    id: 'cold-store-stock',
    category: 'production-records',
    title: 'Cold Store — Stock',
    shortTitle: 'Cold Stock',
    description: 'Cold store stock report',
    vfpCommand: 'DO FORM COLDCHK WITH 2',
    vfpFiles: ['forms/coldchk.scx'],
  },

  // —— Supplier Bikri ——
  {
    id: 'supplier-bikri-entry',
    category: 'supplier-bikri',
    title: 'Supplier Bikri — Add/Edit/Delete',
    shortTitle: 'Sup Bikri',
    description: 'Supplier bikri entry',
    vfpCommand: "DO FORM bikri WITH 'SV',0",
    vfpFiles: ['forms/bikri.scx'],
    vfpNote: 'CTRL+F2',
  },
  {
    id: 'supplier-bikri-list',
    category: 'supplier-bikri',
    title: 'Supplier Bikri — List',
    shortTitle: 'Sup Bikri List',
    description: 'Supplier bikri list',
    vfpCommand: 'DO FORM bikrichk',
    vfpFiles: ['forms/bikrichk.scx'],
  },
  {
    id: 'supplier-bikri-print',
    category: 'supplier-bikri',
    title: 'Supplier Bikri — Print',
    shortTitle: 'Sup Bikri Print',
    description: 'Print supplier bikri',
    vfpCommand: "DO FORM Bikripnt WITH 0,0,'','Y'",
    vfpFiles: ['forms/bikripnt.scx'],
  },
  {
    id: 'supplier-bikri-pending',
    category: 'supplier-bikri',
    title: 'Supplier Bikri — Pending',
    shortTitle: 'Sup Pending',
    description: 'Pending supplier bikri',
    vfpCommand: 'DO FORM bikripnd',
    vfpFiles: ['forms/bikripnd.scx'],
  },

  // —— Customer Bikri ——
  {
    id: 'customer-bikri-entry',
    category: 'customer-bikri',
    title: 'Customer Bikri — Add/Edit/Delete',
    shortTitle: 'Cust Bikri',
    description: 'Customer bikri entry',
    vfpCommand: "DO FORM Cbikri WITH CTOD('  /  /    '),0,'KV'",
    vfpFiles: ['forms/cbikri.scx'],
    vfpNote: 'CTRL+F10',
  },
  {
    id: 'customer-bikri-checklist',
    category: 'customer-bikri',
    title: 'Customer Bikri — Checklist',
    shortTitle: 'Cust Bikri List',
    description: 'Customer bikri checklist',
    vfpCommand: 'DO FORM CBIKCHK',
    vfpFiles: ['forms/cbikchk.scx'],
  },

  // —— TDS Voucher ——
  {
    id: 'tds-voucher-entry',
    category: 'tds-voucher',
    title: 'TDS Voucher',
    shortTitle: 'TDS Voucher',
    description: 'TDS voucher entry',
    vfpCommand: "DO FORM TDS WITH 'TV',G_BLNKDT,0",
    vfpFiles: ['forms/tds.scx'],
  },
  {
    id: 'tds-voucher-checklist',
    category: 'tds-voucher',
    title: 'TDS Voucher — Checklist',
    shortTitle: 'TDS List',
    description: 'TDS voucher checklist',
    vfpCommand: "DO FORM tdschk WITH 'A'",
    vfpFiles: ['forms/tdschk.scx'],
  },
  {
    id: 'tds-deposit-voucher',
    category: 'tds-voucher',
    title: 'TDS Deposit Voucher',
    shortTitle: 'TDS Deposit',
    description: 'TDS deposit voucher',
    vfpCommand: 'DO FORM tdsdepo',
    vfpFiles: ['forms/tdsdepo.scx'],
  },
  {
    id: 'tds-nature',
    category: 'tds-voucher',
    title: 'TDS Nature',
    shortTitle: 'TDS Nature',
    description: 'TDS nature master',
    vfpCommand: 'DO tdsnature',
    vfpFiles: ['prg/tdsnature.prg'],
  },
  {
    id: 'tds-update-detail',
    category: 'tds-voucher',
    title: 'Update TDS Detail',
    shortTitle: 'TDS Update',
    description: 'Update TDS details',
    vfpCommand: 'DO FORM tdsupdt',
    vfpFiles: ['forms/tdsupdt.scx'],
  },
  {
    id: 'tds-acknowledge-no',
    category: 'tds-voucher',
    title: 'TDS Acknowledge No.',
    shortTitle: 'TDS Ack',
    description: 'TDS acknowledgement numbers',
    vfpCommand: 'DO tdsack',
    vfpFiles: ['prg/tdsack.prg'],
  },
  {
    id: 'tds-form',
    category: 'tds-voucher',
    title: 'TDS Form',
    shortTitle: 'TDS Form',
    description: 'TDS form printing',
    vfpCommand: 'DO FORM tdsform',
    vfpFiles: ['forms/tdsform.scx'],
  },
  {
    id: 'tds-26q',
    category: 'tds-voucher',
    title: 'TDS 26Q',
    shortTitle: '26Q',
    description: 'TDS 26Q return',
    vfpCommand: 'DO FORM tds26q',
    vfpFiles: ['forms/tds26q.scx'],
  },
  {
    id: 'tds-testing',
    category: 'tds-voucher',
    title: 'TDS Testing',
    shortTitle: 'TDS Test',
    description: 'TDS testing utility',
    vfpCommand: 'DO tdstst',
    vfpFiles: ['prg/tdstst.prg'],
  },
  {
    id: 'etds',
    category: 'tds-voucher',
    title: 'E-TDS',
    shortTitle: 'E-TDS',
    description: 'Electronic TDS filing',
    vfpCommand: 'DO etds',
    vfpFiles: ['prg/etds.prg'],
  },
  {
    id: 'tds-27a',
    category: 'tds-voucher',
    title: 'TDS 27A',
    shortTitle: '27A',
    description: 'TDS form 27A',
    vfpCommand: 'DO 27a',
    vfpFiles: ['prg/27a.prg'],
  },
  {
    id: 'brokerage-voucher',
    category: 'tds-voucher',
    title: 'Brokerage Voucher',
    shortTitle: 'Brok Voucher',
    description: 'Brokerage TDS voucher',
    vfpCommand: 'DO FORM brokvou',
    vfpFiles: ['forms/brokvou.scx'],
  },
  {
    id: 'party-wise-tds',
    category: 'tds-voucher',
    title: 'Party Wise TDS',
    shortTitle: 'Party TDS',
    description: 'Party-wise TDS report',
    vfpCommand: "DO FORM tdschk WITH 'B'",
    vfpFiles: ['forms/tdschk.scx'],
  },
  {
    id: 'freight-tds-transfer',
    category: 'tds-voucher',
    title: 'Freight TDS Transfer',
    shortTitle: 'Fgt TDS Trf',
    description: 'Freight TDS transfer voucher',
    vfpCommand: 'DO FORM fgt_tds_vou',
    vfpFiles: ['forms/fgt_tds_vou.scx'],
  },
  {
    id: 'brokerage-list',
    category: 'tds-voucher',
    title: 'Brokerage List',
    shortTitle: 'Brok List',
    description: 'Brokerage list report',
    vfpCommand: 'DO FORM broklist',
    vfpFiles: ['forms/broklist.scx'],
  },
  {
    id: 'tcs-update-detail',
    category: 'tds-voucher',
    title: 'Update TCS Detail',
    shortTitle: 'TCS Update',
    description: 'Update TCS details',
    vfpCommand: 'DO FORM tcs_update',
    vfpFiles: ['forms/tcs_update.scx'],
  },
  {
    id: 'tcs-return',
    category: 'tds-voucher',
    title: 'TCS Return',
    shortTitle: 'TCS Return',
    description: 'TCS return filing',
    vfpCommand: 'DO FORM tcs_return',
    vfpFiles: ['forms/tcs_return.scx'],
  },

  // —— Bank Reconciliation ——
  {
    id: 'bank-reconciliation-entry',
    category: 'bank-reconciliation',
    title: 'Bank Reconciliation — Add/Edit/Delete',
    shortTitle: 'Bank Recon',
    description: 'Bank reconciliation entry',
    vfpCommand: 'DO FORM bankrec',
    vfpFiles: ['forms/bankrec.scx'],
  },
  {
    id: 'bank-reconciliation-list',
    category: 'bank-reconciliation',
    title: 'Bank Reconciliation — List',
    shortTitle: 'Bank Recon List',
    description: 'Bank reconciliation list',
    vfpCommand: 'DO FORM bankrchk',
    vfpFiles: ['forms/bankrchk.scx'],
  },
  {
    id: 'bank-reconciliation-trf-voucher',
    category: 'bank-reconciliation',
    title: 'Bank Reconciliation — Trf From Voucher',
    shortTitle: 'Bank Trf',
    description: 'Transfer from voucher to bank recon',
    vfpCommand: 'DO FORM banktrf',
    vfpFiles: ['forms/banktrf.scx'],
  },
  {
    id: 'bank-reconciliation-opening',
    category: 'bank-reconciliation',
    title: 'Bank Reconciliation — Opening Feeding',
    shortTitle: 'Bank Op Bal',
    description: 'Bank reconciliation opening balance',
    vfpCommand: 'DO FORM bankrop',
    vfpFiles: ['forms/bankrop.scx'],
  },

  // —— Freight Voucher ——
  {
    id: 'freight-voucher-entry',
    category: 'freight-voucher',
    title: 'Freight Voucher — Add/Edit/Delete',
    shortTitle: 'Freight Entry',
    description: 'Freight voucher entry',
    vfpCommand: "DO FORM fgtadd WITH 'FV',0,''",
    vfpFiles: ['forms/fgtadd.scx'],
  },
  {
    id: 'freight-voucher-checklist',
    category: 'freight-voucher',
    title: 'Freight Voucher — Checklist',
    shortTitle: 'Freight List',
    description: 'Freight voucher checklist',
    vfpCommand: 'DO FORM fgtchk',
    vfpFiles: ['forms/fgtchk.scx'],
  },
  {
    id: 'freight-service-tax-report',
    category: 'freight-voucher',
    title: 'Freight — Service Tax Report',
    shortTitle: 'Fgt STax',
    description: 'Freight service tax report',
    vfpCommand: 'DO FORM fgtstax',
    vfpFiles: ['forms/fgtstax.scx'],
  },
  {
    id: 'freight-tds-list',
    category: 'freight-voucher',
    title: 'Freight — TDS List',
    shortTitle: 'Fgt TDS List',
    description: 'Freight TDS list',
    vfpCommand: 'DO FORM fgttds',
    vfpFiles: ['forms/fgttds.scx'],
  },

  // —— Reverse Charge & Indent ——
  {
    id: 'reverse-charge-invoice',
    category: 'reverse-charge',
    title: 'Reverse Charge Invoice',
    shortTitle: 'Rev Charge',
    description: 'Reverse charge invoice entry',
    vfpCommand: "DO FORM REVERSE_CHARGE WITH 'RC',CTOD('  /  /    '),0,'','N'",
    vfpFiles: ['forms/reverse_charge.scx'],
  },
  {
    id: 'indent-voucher',
    category: 'indent-voucher',
    title: 'Indent Voucher',
    shortTitle: 'Indent',
    description: 'Indent voucher entry',
    vfpCommand: "DO FORM indent WITH 'IN',0",
    vfpFiles: ['forms/indent.scx'],
  },
];

const TRANSACTION_BY_ID = Object.fromEntries(TRANSACTION_MODULE_ITEMS.map((m) => [m.id, m]));

function transactionItemToMenuTile(m) {
  return {
    id: m.id,
    title: m.title,
    shortTitle: m.shortTitle,
    description: m.implemented ? m.description : `${m.description} · Web UI pending`,
  };
}

export function menuModuleIdForTransactionItem(item) {
  if (!item) return TRANSACTION_MENU_MODULE_ID;
  if (VOUCHER_MENU_CATEGORIES.has(item.category)) return VOUCHER_MENU_MODULE_ID;
  if (item.category === 'purchase-records') return PURCHASE_MENU_MODULE_ID;
  if (item.category === 'sale-records') return SALES_MENU_MODULE_ID;
  return TRANSACTION_MENU_MODULE_ID;
}

export function resolveMenuModuleForReportType(reportType) {
  const item = findTransactionModuleItem(reportType);
  if (item) return menuModuleIdForTransactionItem(item);
  return null;
}

export function findTransactionModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return TRANSACTION_BY_ID[id] || null;
}

export function isTransactionModuleItem(reportId) {
  return Boolean(findTransactionModuleItem(reportId));
}

export function transactionCategoryLabel(categoryId) {
  const c = TRANSACTION_CATEGORIES.find((x) => x.id === categoryId);
  return c?.label || categoryId || '';
}

export function resolveTransactionSlideNo(reportType) {
  const item = findTransactionModuleItem(reportType);
  if (!item) return null;
  if (item.implemented && item.slide) return item.slide;
  return TRANSACTION_PLACEHOLDER_SLIDE;
}

/** Menu tiles — production, bikri, TDS, bank recon, freight, RC, indent only. */
export function transactionMenuItemsForReportConfig() {
  return TRANSACTION_MODULE_ITEMS.filter((m) => menuModuleIdForTransactionItem(m) === TRANSACTION_MENU_MODULE_ID).map(
    transactionItemToMenuTile
  );
}

export function cashVoucherHubActions() {
  return voucherHubActionsForEntry('cash-voucher-entry');
}

/** @param {string} entryId */
export function voucherHubActionsForEntry(entryId) {
  const ids = VOUCHER_HUB_ACTION_IDS_BY_ENTRY[entryId] || [];
  return ids.map((id) => findTransactionModuleItem(id)).filter(Boolean);
}

/** Ordered children of Sale Records > Sales Order. */
export function salesOrderHubActions() {
  return SALES_ORDER_HUB_ACTION_IDS.map((id) => findTransactionModuleItem(id)).filter(Boolean);
}

/** Ordered children of Sale Records > Dispatch Challan. */
export function dispatchChallanHubActions() {
  return DISPATCH_CHALLAN_HUB_ACTION_IDS.map((id) => findTransactionModuleItem(id)).filter(Boolean);
}

/** @param {string} entryId */
export function voucherEntrySlideForEntryId(entryId) {
  const item = findTransactionModuleItem(entryId);
  return item?.implemented && item.slide ? item.slide : TRANSACTION_PLACEHOLDER_SLIDE;
}

/** Cash, bank, journal entry hubs only — Vouchers module menu. */
export function voucherTransactionMenuItemsForReportConfig() {
  return VOUCHER_MENU_ENTRY_IDS.map((id) => findTransactionModuleItem(id))
    .filter(Boolean)
    .map(transactionItemToMenuTile);
}

/** Purchase module menu — entry screens only. */
export function purchaseTransactionMenuItemsForReportConfig() {
  return PURCHASE_MENU_ENTRY_IDS.map((id) => findTransactionModuleItem(id))
    .filter(Boolean)
    .map(transactionItemToMenuTile);
}

/** Sale records — VFP transactio salerecord popup (excl. items covered by Sale List / Sale Print). */
export function saleTransactionMenuItemsForReportConfig() {
  return TRANSACTION_MODULE_ITEMS.filter(
    (m) => m.category === 'sale-records' && !SALE_MENU_EXCLUDE_IDS.has(m.id)
  ).map(transactionItemToMenuTile);
}

/** Top-level modules on the Sales landing screen. */
export function salesRootMenuItemsForReportConfig() {
  return SALES_ROOT_MENU_ENTRY_IDS.map((id) => findTransactionModuleItem(id))
    .filter(Boolean)
    .map(transactionItemToMenuTile);
}

export { GFASORCL_VFP_PATHS };
