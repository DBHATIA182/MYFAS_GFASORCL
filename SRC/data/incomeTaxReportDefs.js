/**
 * Income tax report UI definitions — filters and display metadata per report id.
 * SQL/logic lives in server/incomeTaxReports.cjs (VFP prg/itaxrpt.prg + related).
 */

import { formatLedgerDateDisplay } from '../utils/dateFormat';

/** @typedef {'sdt'|'edt'|'minAmt'|'topN'|'scheduleNo'|'stateCode'|'scode'|'icode'|'bkCode'|'bkName'|'godCode'|'mcode'|'mdc'|'mru'|'bNo'|'panYn'|'spNo'} IncomeTaxFilterKey */

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

/** CASH EXP. / NON CASH EXP. row → API exp_type */
export function resolveExpenseExpType(headName) {
  const h = String(headName ?? '').trim().toUpperCase();
  if (h.includes('NON')) return 'noncash';
  if (h.includes('CASH')) return 'cash';
  return null;
}

export function fiscalMonthColLabel(monthKey) {
  const key = String(monthKey ?? '').trim().toUpperCase();
  return FISCAL_MONTH_COLS.find((c) => c.key === key)?.label || key;
}

/** @type {Record<string, { filters: IncomeTaxFilterKey[], pdfLandscape?: boolean, ledgerDrilldown?: boolean, compactTable?: boolean, displayColumns?: object[] }>} */
export const INCOME_TAX_REPORT_DEFS = {
  'loaner-list': {
    filters: ['sdt', 'edt', 'scheduleNo'],
    ledgerDrilldown: true,
    compactTable: true,
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn(),
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'OP', label: 'Op', type: 'num' },
      { key: 'CR_AMT', label: 'Cr Amt', type: 'num' },
      { key: 'CR_INT', label: 'Cr Int', type: 'num' },
      { key: 'TOT_CR', label: 'Tot Cr', type: 'num' },
      { key: 'DR_AMT', label: 'Dr Amt', type: 'num' },
      { key: 'DR_TDS', label: 'Dr Tds', type: 'num' },
      { key: 'TOT_DR', label: 'Tot Dr', type: 'num' },
      { key: 'CL_BAL', label: 'Cl Bal', type: 'num' },
    ],
  },
  'broker-list': {
    filters: ['sdt', 'edt', 'scheduleNo'],
    ledgerDrilldown: true,
    compactTable: true,
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn(),
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'OP', label: 'Op', type: 'num' },
      { key: 'CR_AMT', label: 'Cr Amt', type: 'num' },
      { key: 'DR_AMT', label: 'Dr Amt', type: 'num' },
      { key: 'DR_TDS', label: 'Dr Tds', type: 'num' },
      { key: 'CL_BAL', label: 'Cl Bal', type: 'num' },
    ],
  },
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
  'top-party-sales': {
    filters: ['sdt', 'edt', 'topN'],
    ledgerDrilldown: true,
    compactTable: true,
    topSalesCards: true,
    grandTotalLabelKey: 'NAME',
    filterOverrides: {
      topN: {
        label: 'Top Number',
        hint: 'How many top parties to show (default 10).',
        defaultValue: '10',
      },
    },
    displayColumns: [
      { key: 'RANK_NO', label: '#', type: 'num' },
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn('CITY'),
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
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
  'customer-arhat': {
    filters: ['sdt', 'edt', 'scode'],
    ledgerDrilldown: true,
    compactTable: true,
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'partyBlock', subKeys: ['CITY'] },
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'CR_AMT', label: 'Cr Amt', type: 'num' },
    ],
    filterOverrides: {
      scode: {
        label: 'Arhat Code',
        hint: 'Select arhat account from master (ordered by name).',
        defaultValue: 'O05001',
        pickList: 'masterAccount',
        required: true,
      },
    },
  },
  'dami-wise-sales': {
    filters: ['sdt', 'edt'],
    monthSummaryCards: true,
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
      { key: 'AMT175', label: 'Amt 1.75%', type: 'num' },
      { key: 'AMT3125', label: 'Amt 3.125%', type: 'num' },
      { key: 'AMT0', label: 'Amt Other', type: 'num' },
    ],
  },
  'monthly-purchase-report': {
    filters: ['sdt', 'edt', 'scheduleNo'],
    monthSummaryCards: true,
    pdfLandscape: false,
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
    ],
  },
  'monthly-sales-report': {
    filters: ['sdt', 'edt'],
    monthSummaryCards: true,
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'T_SALE_QTY', label: 'TdgSaleQty', type: 'num' },
      { key: 'T_SALE_WGT', label: 'TdgSaleWgt', type: 'num' },
      { key: 'T_SALE', label: 'TdgSaleAmt', type: 'num' },
      { key: 'C_SALE_QTY', label: 'ConSaleQty', type: 'num' },
      { key: 'C_SALE_WGT', label: 'ConSaleWgt', type: 'num' },
      { key: 'C_SALE', label: 'ConSaleAmt', type: 'num' },
      { key: 'QNTY', label: 'TotalQty', type: 'num' },
      { key: 'WEIGHT', label: 'TotalWgt', type: 'num' },
      { key: 'AMOUNT', label: 'TotalAmt', type: 'num' },
    ],
  },
  'item-wise-purchase-sale': {
    filters: ['sdt', 'edt'],
    monthSummaryCards: true,
    itemGroupWithTotals: true,
    itemGroupKeys: ['ITEM_CODE', 'ITEM_NAME'],
    mobileCardHeadKeys: ['CMTH'],
    displayColumns: [
      { key: 'ITEM_CODE', label: 'Item Code', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item Name', type: 'text' },
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'P_QTY', label: 'PurQty', type: 'num' },
      { key: 'D_QTY', label: 'DntQty', type: 'num' },
      { key: 'P_WGT', label: 'PurWgt', type: 'num' },
      { key: 'D_WGT', label: 'DntWgt', type: 'num' },
      { key: 'P_AMT', label: 'PurAmt', type: 'num' },
      { key: 'S_QTY', label: 'SaleQty', type: 'num' },
      { key: 'C_QTY', label: 'CntQty', type: 'num' },
      { key: 'S_WGT', label: 'SaleWgt', type: 'num' },
      { key: 'C_WGT', label: 'CntWgt', type: 'num' },
      { key: 'S_AMT', label: 'SaleAmt', type: 'num' },
    ],
  },
  'item-wise-sales-dami': {
    filters: ['sdt', 'edt', 'stateCode'],
    monthSummaryCards: true,
    compactTable: true,
    itemGroupWithTotals: true,
    itemGroupKeys: ['ITEM_CODE'],
    itemGroupHideKeys: ['ITEM_CODE'],
    mobileCardHeadKeys: ['CMTH'],
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'S_QTY', label: 'SaleQty', type: 'num' },
      { key: 'S_WGT', label: 'SaleWgt', type: 'num' },
      { key: 'S_AMT', label: 'SaleAmt', type: 'num' },
      { key: 'S_COMM', label: 'Commission', type: 'num' },
    ],
  },
  'party-wise-purchase-bill': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['SUP_CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
    grandTotalLabelKey: 'R_DATE',
    displayColumns: [
      { key: 'R_DATE', label: 'R Date', type: 'date' },
      { key: 'R_NO', label: 'R No', type: 'text' },
      { key: 'BILL_NO', label: 'Bill No', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'party-wise-sale-bill': {
    filters: ['sdt', 'edt', 'scheduleNo'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
    grandTotalLabelKey: 'BILL_DATE',
    displayColumns: [
      { key: 'BILL_DATE', label: 'Bill Date', type: 'date' },
      { key: 'BILL_NO', label: 'Bill No', type: 'text' },
      { key: 'B_TYPE', label: 'B Type', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'party-wise-purchase-item': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['SUP_CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
    grandTotalLabelKey: 'ITEM_NAME',
    displayColumns: [
      { key: 'ITEM_CODE', label: 'Item Code', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item Name', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'party-wise-sale-item': {
    filters: ['sdt', 'edt', 'scode'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
    grandTotalLabelKey: 'ITEM_NAME',
    filterOverrides: {
      scode: {
        label: 'Party Code',
        hint: 'Select party from master (name, city, code). Leave blank for all parties.',
        pickList: 'masterAccount',
      },
    },
    displayColumns: [
      { key: 'ITEM_CODE', label: 'Item Code', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item Name', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'item-wise-sales-party': {
    filters: ['sdt', 'edt', 'scode', 'icode'],
    ledgerDrilldown: true,
    compactTable: true,
    monthSummaryCards: true,
    itemGroupWithTotals: true,
    itemGroupKeys: ['ITEM_CODE', 'ITEM_NAME'],
    itemGroupHideKeys: ['ITEM_CODE', 'ITEM_NAME'],
    grandTotalLabelKey: 'NAME',
    mobileCardHeadKeys: ['CODE', 'NAME'],
    filterOverrides: {
      scode: {
        label: 'Party Code',
        hint: 'Select party from master (optional). Leave blank for all parties.',
        pickList: 'masterAccount',
      },
      icode: {
        label: 'Item Code',
        hint: 'Select item from item master (optional). Leave blank for all items.',
        pickList: 'itemMaster',
      },
    },
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'CITY', label: 'City', type: 'text' },
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'party-wise-sale-month': {
    filters: ['sdt', 'edt', 'stateCode'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
    grandTotalLabelKey: 'CMTH',
    mobileCardHeadKeys: ['CMTH'],
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'item-wise-sale-month-party': {
    filters: ['sdt', 'edt', 'icode'],
    ledgerDrilldown: true,
    compactTable: true,
    itemPartyMonthGroups: true,
    itemGroupKeys: ['ITEM_CODE', 'ITEM_NAME'],
    itemGroupHideKeys: ['ITEM_CODE', 'ITEM_NAME'],
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
    grandTotalLabelKey: 'CMTH',
    mobileCardHeadKeys: ['CMTH'],
    filterOverrides: {
      icode: {
        label: 'Item Code',
        hint: 'Select item from item master (optional). Leave blank for all items.',
        pickList: 'itemMaster',
      },
    },
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'supplier-sales-customer-wise': {
    filters: ['sdt', 'edt', 'scode', 'icode', 'godCode', 'minAmt'],
    ledgerDrilldown: true,
    compactTable: true,
    monthSummaryCards: true,
    grandTotalLabelKey: 'NAME',
    selectionSummaryKeys: ['scode', 'icode', 'godCode'],
    mobileCardHeadKeys: ['CODE', 'NAME'],
    filterOverrides: {
      scode: {
        label: 'Supplier Code',
        hint: 'Select supplier (S/T accounts from master). Leave blank for all suppliers.',
        pickList: 'masterSupplier',
      },
      icode: {
        label: 'Item Code',
        hint: 'Select item from item master (optional). Leave blank for all items.',
        pickList: 'itemMaster',
      },
      godCode: {
        label: 'Godown Code',
        hint: 'Select godown (optional). Leave blank for all godowns.',
        pickList: 'godown',
      },
    },
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'CITY', label: 'City', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'lot-wise-purchase-sale': {
    filters: ['sdt', 'edt', 'scode', 'icode', 'bNo', 'scheduleNo'],
    compactTable: true,
    billGroupWithTotals: true,
    billGroupKeys: ['B_NO'],
    billGroupHideKeys: ['B_NO'],
    billBalanceTotals: true,
    grandTotalLabelKey: 'B_NO',
    monthSummaryCards: true,
    mobileCardHeadKeys: ['SUP_CODE', 'ITEM_NAME', 'LOT'],
    filterOverrides: {
      scode: {
        label: 'Supplier Code',
        hint: 'Select supplier (S/T accounts from master). Leave blank for all suppliers.',
        pickList: 'masterSupplier',
      },
      icode: {
        label: 'Item Code',
        hint: 'Select item from item master (optional). Leave blank for all items.',
        pickList: 'itemMaster',
      },
      bNo: {
        label: 'B.No',
        hint: 'Bill number filter (optional). Leave blank for all bills.',
      },
    },
    displayColumns: [
      { key: 'B_NO', label: 'B.No', type: 'text' },
      { key: 'SUP_CODE', label: 'Supplier Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'ITEM_CODE', label: 'Item Code', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item Name', type: 'text' },
      { key: 'LOT', label: 'Lot', type: 'text' },
      { key: 'STATUS', label: 'Status', type: 'text' },
      { key: 'VR_DATE', label: 'Vr Date', type: 'date' },
      { key: 'VR_NO', label: 'Vr No', type: 'text' },
      { key: 'VR_TYPE', label: 'Vr Type', type: 'text' },
      { key: 'GOD_CODE', label: 'Godown', type: 'text' },
      { key: 'REMARKS', label: 'Remarks', type: 'text' },
      { key: 'R_QNTY', label: 'R Qty', type: 'num' },
      { key: 'S_QNTY', label: 'S Qty', type: 'num' },
      { key: 'R_WEIGHT', label: 'R Wt', type: 'num' },
      { key: 'S_WEIGHT', label: 'S Wt', type: 'num' },
      { key: 'BAL_QTY', label: 'Bal Qty', type: 'num' },
      { key: 'BAL_WGT', label: 'Bal Wt', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
      { key: 'AVG_RATE', label: 'Avg Rate', type: 'num' },
      { key: 'BAL_AMOUNT', label: 'Bal Amount', type: 'num' },
      { key: 'DANE', label: 'Dane', type: 'num' },
      { key: 'PAPLOO1', label: 'Paploo1', type: 'num' },
      { key: 'PAPLOO2', label: 'Paploo2', type: 'num' },
      { key: 'PAPLOO3', label: 'Paploo3', type: 'num' },
      { key: 'PAPLOO5', label: 'Paploo5', type: 'num' },
      { key: 'COMMISSION', label: 'Commission', type: 'num' },
      { key: 'BROKERAGE', label: 'Brokerage', type: 'num' },
      { key: 'CUST_NAME', label: 'Customer', type: 'text' },
      { key: 'ITEM_CAT', label: 'Item Cat', type: 'text' },
      { key: 'SCHEDULE', label: 'Schedule', type: 'text' },
      { key: 'MSUP_CODE', label: 'M Sup Code', type: 'text' },
      { key: 'MSUP_NAME', label: 'M Sup Name', type: 'text' },
    ],
  },
  'item-wise-purchase': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    monthSummaryCards: true,
    itemGroupWithTotals: true,
    itemGroupKeys: ['ITEM_CODE', 'ITEM_NAME'],
    itemGroupHideKeys: ['ITEM_CODE', 'ITEM_NAME'],
    grandTotalLabelKey: 'NAME',
    mobileCardHeadKeys: ['CODE', 'NAME'],
    displayColumns: [
      { key: 'ITEM_CODE', label: 'Item Code', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item Name', type: 'text' },
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'CITY', label: 'City', type: 'text' },
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'item-wise-purchase-monthly': {
    filters: ['sdt', 'edt', 'bkCode', 'icode'],
    ledgerDrilldown: true,
    compactTable: true,
    itemPartyMonthGroups: true,
    itemGroupKeys: ['ITEM_CODE', 'ITEM_NAME'],
    itemGroupHideKeys: ['ITEM_CODE', 'ITEM_NAME'],
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['CODE', 'NAME', 'CITY'],
    grandTotalLabelKey: 'CMTH',
    selectionSummaryKeys: ['bkCode', 'icode'],
    mobileCardHeadKeys: ['CMTH'],
    filterOverrides: {
      bkCode: {
        label: 'Broker Code',
        hint: 'Select broker (B accounts from master). Leave blank for all brokers.',
        pickList: 'masterBroker',
      },
      icode: {
        label: 'Item Code',
        hint: 'Select item from item master (optional). Leave blank for all items.',
        pickList: 'itemMaster',
      },
    },
    displayColumns: [
      { key: 'CMTH', label: 'Month', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'RATE', label: 'Rate', type: 'num' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
    ],
  },
  'party-wise-sale-tdg-consg': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn(),
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'GST_NO', label: 'Gst No', type: 'text' },
      { key: 'TDG_WGT', label: 'Tdg Wgt', type: 'num' },
      { key: 'CONSG_WGT', label: 'Consg Wgt', type: 'num' },
      { key: 'TDG_SALE', label: 'Tdg Sale', type: 'num' },
      { key: 'CONSG_SALE', label: 'Consg Sale', type: 'num' },
      { key: 'TDG_PAP', label: 'Tdg Pap', type: 'num' },
      { key: 'CONSG_PAP', label: 'Consg Pap', type: 'num' },
      { key: 'TDG_DANE', label: 'Tdg Dane', type: 'num' },
      { key: 'CONSG_DANE', label: 'Consg Dane', type: 'num' },
      { key: 'TDG_COMM', label: 'Tdg Comm', type: 'num' },
      { key: 'CONSG_COMM', label: 'Consg Comm', type: 'num' },
      { key: 'TDG_BROK', label: 'Tdg Brok', type: 'num' },
      { key: 'CONSG_BROK', label: 'Consg Brok', type: 'num' },
      { key: 'TDG_EXP', label: 'Tdg Exp', type: 'num' },
      { key: 'CONSG_EXP', label: 'Consg Exp', type: 'num' },
      { key: 'WOCOMM_BROK', label: 'Wocomm Brok', type: 'num' },
      { key: 'COMM_SD_BROK', label: 'Comm Sd Brok', type: 'num' },
      { key: 'WOCOMM_SD_BROK', label: 'Wocomm Sd Brok', type: 'num' },
      { key: 'NET_SALE', label: 'Net Sale', type: 'num' },
      { key: 'OP_BAL', label: 'Op Bal', type: 'num' },
      { key: 'SALE', label: 'Sale', type: 'num' },
      { key: 'RECEIPTS', label: 'Receipts', type: 'num' },
      { key: 'CL_BAL', label: 'Cl Bal', type: 'num' },
    ],
  },
  'sale-above-amount': {
    filters: ['sdt', 'edt', 'minAmt'],
    ledgerDrilldown: true,
    compactTable: true,
    grandTotalLabelKey: 'NAME',
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn(),
      { key: 'PAN', label: 'Pan', type: 'text' },
      { key: 'GST_NO', label: 'Gst No', type: 'text' },
      { key: 'BILL_CNT', label: 'Bills', type: 'num' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
      { key: 'TDS_AMOUNT', label: 'Tds Amount', type: 'num' },
    ],
  },
  'sale-detail-excel': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    grandTotalLabelKey: 'NAME',
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn('PAN', 'TIN'),
      { key: 'OPENING', label: 'Opening', type: 'num' },
      { key: 'SALE_AMOUNT', label: 'Sale Amount', type: 'num' },
      { key: 'CN_AMOUNT', label: 'CN Amount', type: 'num' },
      { key: 'CASH_RECEIPT', label: 'Cash Receipt', type: 'num' },
      { key: 'BANK_RECEIPT', label: 'Bank Receipt', type: 'num' },
      { key: 'JOURNAL_ADJ', label: 'Journal Adj', type: 'num' },
      { key: 'CL_BAL', label: 'Cl Balance', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'PAN', label: 'Pan' },
      { key: 'TIN', label: 'Tin' },
      { key: 'ADD1', label: 'Add1' },
      { key: 'ADD2', label: 'Add2' },
      { key: 'ADD3', label: 'Add3' },
      { key: 'CITY', label: 'City' },
      { key: 'OPENING', label: 'Opening' },
      { key: 'SALE_AMOUNT', label: 'Sale Amount' },
      { key: 'CN_AMOUNT', label: 'CN Amount' },
      { key: 'CASH_RECEIPT', label: 'Cash Receipt' },
      { key: 'BANK_RECEIPT', label: 'Bank Receipt' },
      { key: 'JOURNAL_ADJ', label: 'Journal Adj' },
      { key: 'CL_BAL', label: 'Cl Balance' },
    ],
  },
  'item-wise-sales-detail': {
    filters: ['sdt', 'edt'],
    compactTable: true,
    monthSummaryCards: true,
    grandTotalLabelKey: 'ITEM_NAME',
    mobileCardHeadKeys: ['ITEM_CODE', 'ITEM_NAME'],
    displayColumns: [
      { key: 'ITEM_CODE', label: 'Item Code', type: 'text' },
      { key: 'ITEM_NAME', label: 'Item Name', type: 'text' },
      { key: 'S_QTY', label: 'Sale Qty', type: 'num' },
      { key: 'S_WGT', label: 'Sale Wt', type: 'num' },
      { key: 'S_AMT', label: 'Sale Amt', type: 'num' },
      { key: 'S_COMM', label: 'Commission', type: 'num' },
    ],
  },
  'ledger-dccode-report': {
    filters: ['sdt', 'edt', 'scode', 'mdc', 'mru', 'scheduleNo'],
    ledgerDrilldown: true,
    ledgerDrillKeys: { party: 'CODE', detail: 'DC_CODE' },
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME'],
    partyGroupHeaderMinimal: true,
    grandTotalLabelKey: 'DC_CODE',
    mobileCardHeadKeys: ['DC_CODE', 'DC_NAME'],
    filterOverrides: {
      scode: {
        label: 'Party Code',
        hint: 'Select party from master (name, city, code). Required if schedule is blank.',
        pickList: 'masterAccount',
      },
      scheduleNo: {
        label: 'Schedule No',
        hint: 'Select schedule (name, no — decimal schedules only). Required if party is blank.',
        pickList: 'scheduleMaster',
      },
    },
    displayColumns: [
      { key: 'DC_CODE', label: 'DC Code', type: 'text' },
      {
        key: 'DC_NAME',
        label: 'DC Name',
        type: 'partyBlock',
        subKeys: ['ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO'],
      },
      { key: 'DR_AMT', label: 'Dr Amt', type: 'num' },
      { key: 'CR_AMT', label: 'Cr Amt', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'DC_CODE', label: 'DC Code' },
      { key: 'DC_NAME', label: 'DC Name' },
      { key: 'ADD1', label: 'Add1' },
      { key: 'ADD2', label: 'Add2' },
      { key: 'CITY', label: 'City' },
      { key: 'PAN', label: 'Pan' },
      { key: 'GST_NO', label: 'Gst No' },
      { key: 'DR_AMT', label: 'Dr Amt' },
      { key: 'CR_AMT', label: 'Cr Amt' },
    ],
  },
  'purchase-detail-excel': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    grandTotalLabelKey: 'NAME',
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn('PAN', 'TIN'),
      { key: 'OPENING', label: 'Opening', type: 'num' },
      { key: 'PUR_AMOUNT', label: 'Pur Amount', type: 'num' },
      { key: 'DN_AMOUNT', label: 'DN Amount', type: 'num' },
      { key: 'CASH_PAYMENT', label: 'Cash Payment', type: 'num' },
      { key: 'BANK_PAYMENT', label: 'Bank Payment', type: 'num' },
      { key: 'JOURNAL', label: 'Journal', type: 'num' },
      { key: 'CL_BAL', label: 'Cl Balance', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'PAN', label: 'Pan' },
      { key: 'TIN', label: 'Tin' },
      { key: 'ADD1', label: 'Add1' },
      { key: 'ADD2', label: 'Add2' },
      { key: 'ADD3', label: 'Add3' },
      { key: 'CITY', label: 'City' },
      { key: 'OPENING', label: 'Opening' },
      { key: 'PUR_AMOUNT', label: 'Pur Amount' },
      { key: 'DN_AMOUNT', label: 'DN Amount' },
      { key: 'CASH_PAYMENT', label: 'Cash Payment' },
      { key: 'BANK_PAYMENT', label: 'Bank Payment' },
      { key: 'JOURNAL', label: 'Journal' },
      { key: 'CL_BAL', label: 'Cl Balance' },
    ],
  },
  'cash-movement-monthly': {
    filters: ['sdt', 'edt', 'mcode', 'panYn', 'spNo'],
    compactTable: true,
    grandTotalLabelKey: 'MONTH',
    filterOverrides: {
      mcode: {
        label: 'Cash Code',
        defaultValue: '13801C',
        pickList: 'cashAccount',
        hint: 'Select cash account (schedules 9.10, 9.20, 9.30). Default 13801C.',
      },
      panYn: {
        label: 'PAN Type',
        hint: 'Y = with PAN, N = without PAN, blank = all parties.',
      },
      spNo: {
        label: 'Schedule Filter',
        pickList: 'scheduleMaster',
        hint: 'Select schedule (decimal schedules only). Blank = all schedules.',
      },
    },
    displayColumns: [
      { key: 'MONTH', label: 'Month', type: 'text' },
      { key: 'OP_BAL', label: 'Opening', type: 'num' },
      { key: 'CASH_ADD', label: 'Addition', type: 'num' },
      { key: 'BANK_DEP', label: 'Bank Dep.', type: 'num' },
      { key: 'CASH_EXP', label: 'Cash Exp.', type: 'num' },
      { key: 'CASH_PUR', label: 'Cash Pur.', type: 'num' },
      { key: 'CASH_DRAW', label: 'Cash Drawing', type: 'num' },
      { key: 'CASH_OTH', label: 'Cash Others', type: 'num' },
      { key: 'CL_BAL', label: 'Closing Bal.', type: 'num' },
    ],
  },
  'monthly-cash-noncash-exp': {
    filters: ['sdt', 'edt'],
    monthPivot: true,
    monthExpenseDrill: true,
    compactTable: true,
    ledgerDrilldown: true,
    displayColumns: [
      { key: 'HEAD_NAME', label: 'Head', type: 'text' },
      ...FISCAL_MONTH_COLS,
      { key: 'TOT', label: 'Tot', type: 'num' },
    ],
    drillDisplayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'VR_DATE', label: 'Vr.Date', type: 'date' },
      { key: 'VR_NO', label: 'Vr.No.', type: 'text' },
      { key: 'VR_TYPE', label: 'VrType', type: 'text' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
    ],
    drillPartyGroup: true,
    drillPartyGroupKeys: ['CODE'],
    drillPartySuppressHeader: true,
    drillPartyBlankRepeatKeys: ['CODE', 'NAME'],
    drillPartySubtotalLabelKey: 'NAME',
    drillPartySubtotalLabel: 'CODE TOTAL',
  },
  'customer-bill-payment-detail': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'ADD3', 'CITY', 'PAN', 'GST_NO'],
    partyGroupSubtotalLabel: 'CODE TOTAL',
    grandTotalLabelKey: 'BILL_DATE',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'B_TYPE'],
    displayColumns: [
      { key: 'BILL_DATE', label: 'Bill Date', type: 'date' },
      { key: 'BILL_NO', label: 'Bill No', type: 'text' },
      { key: 'B_TYPE', label: 'B Type', type: 'text' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
      { key: 'RET_AMT', label: 'Ret Amt', type: 'num' },
      { key: 'INT_AMT', label: 'Int Amt', type: 'num' },
      { key: 'CASH_PMT', label: 'Cash Pmt', type: 'num' },
      { key: 'CHQ_PMT', label: 'Chq Pmt', type: 'num' },
      { key: 'OTHERS', label: 'Others', type: 'num' },
      { key: 'NET_AMT', label: 'Net Amt', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'ADD1', label: 'Add1' },
      { key: 'ADD2', label: 'Add2' },
      { key: 'ADD3', label: 'Add3' },
      { key: 'CITY', label: 'City' },
      { key: 'PAN', label: 'Pan' },
      { key: 'GST_NO', label: 'Gst No' },
      { key: 'BILL_DATE', label: 'Bill Date' },
      { key: 'BILL_NO', label: 'Bill No' },
      { key: 'B_TYPE', label: 'B Type' },
      { key: 'BILL_AMT', label: 'Bill Amt' },
      { key: 'RET_AMT', label: 'Ret Amt' },
      { key: 'INT_AMT', label: 'Int Amt' },
      { key: 'CASH_PMT', label: 'Cash Pmt' },
      { key: 'CHQ_PMT', label: 'Chq Pmt' },
      { key: 'OTHERS', label: 'Others' },
      { key: 'NET_AMT', label: 'Net Amt' },
    ],
  },
  'customer-bill-payment-summary': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    grandTotalLabelKey: 'CODE',
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      partyNameColumn('PAN', 'GST_NO'),
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
      { key: 'RET_AMT', label: 'Ret Amt', type: 'num' },
      { key: 'INT_AMT', label: 'Int Amt', type: 'num' },
      { key: 'CASH_PMT', label: 'Cash Pmt', type: 'num' },
      { key: 'CHQ_PMT', label: 'Chq Pmt', type: 'num' },
      { key: 'OTHERS', label: 'Others', type: 'num' },
      { key: 'NET_AMT', label: 'Net Amt', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'ADD1', label: 'Add1' },
      { key: 'ADD2', label: 'Add2' },
      { key: 'ADD3', label: 'Add3' },
      { key: 'CITY', label: 'City' },
      { key: 'PAN', label: 'Pan' },
      { key: 'GST_NO', label: 'Gst No' },
      { key: 'BILL_AMT', label: 'Bill Amt' },
      { key: 'RET_AMT', label: 'Ret Amt' },
      { key: 'INT_AMT', label: 'Int Amt' },
      { key: 'CASH_PMT', label: 'Cash Pmt' },
      { key: 'CHQ_PMT', label: 'Chq Pmt' },
      { key: 'OTHERS', label: 'Others' },
      { key: 'NET_AMT', label: 'Net Amt' },
    ],
  },
  'broker-station-wise-sales': {
    filters: ['sdt', 'edt', 'bkCode'],
    ledgerDrilldown: true,
    compactTable: true,
    itemPartyMonthGroups: true,
    itemGroupKeys: ['BK_CODE', 'BK_NAME'],
    itemGroupHideKeys: ['BK_CODE', 'BK_NAME'],
    itemGroupLabelFn: 'broker',
    partyGroupKeys: ['STATE_CODE', 'STATE', 'CITY'],
    partyGroupHideKeys: ['STATE_CODE', 'STATE', 'CITY'],
    partyHeaderType: 'group',
    partyGroupLabelFn: 'stateCity',
    partySubtotalLabel: 'CITY TOTAL',
    itemSubtotalLabel: 'BROKER TOTAL',
    grandTotalLabelKey: 'NAME',
    mobileCardHeadKeys: ['CODE', 'NAME'],
    filterOverrides: {
      bkCode: {
        label: 'Broker Code',
        hint: 'Select broker (B accounts). Leave blank for all brokers.',
        pickList: 'masterBroker',
      },
    },
    displayColumns: [
      { key: 'CODE', label: 'Code', type: 'text' },
      { key: 'NAME', label: 'Name', type: 'text' },
      { key: 'QNTY', label: 'Qty', type: 'num' },
      { key: 'WEIGHT', label: 'Weight', type: 'num' },
      { key: 'AMOUNT', label: 'Amount', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'BK_CODE', label: 'Broker Code' },
      { key: 'BK_NAME', label: 'Broker Name' },
      { key: 'STATE_CODE', label: 'State Code' },
      { key: 'STATE', label: 'State' },
      { key: 'CITY', label: 'City' },
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'QNTY', label: 'Qty' },
      { key: 'WEIGHT', label: 'Weight' },
      { key: 'AMOUNT', label: 'Amount' },
    ],
  },
  'supplier-bill-payment-detail': {
    filters: ['sdt', 'edt'],
    ledgerDrilldown: true,
    compactTable: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['NAME', 'ADD1', 'ADD2', 'ADD3', 'CITY', 'PAN', 'GST_NO'],
    partyGroupSubtotalLabel: 'CODE TOTAL',
    grandTotalLabelKey: 'BILL_DATE',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO'],
    displayColumns: [
      { key: 'BILL_DATE', label: 'Bill Date', type: 'date' },
      { key: 'BILL_NO', label: 'Bill No', type: 'text' },
      { key: 'BILL_AMT', label: 'Bill Amt', type: 'num' },
      { key: 'RET_AMT', label: 'Ret Amt', type: 'num' },
      { key: 'INT_AMT', label: 'Int Amt', type: 'num' },
      { key: 'CASH_PMT', label: 'Cash Pmt', type: 'num' },
      { key: 'CHQ_PMT', label: 'Chq Pmt', type: 'num' },
      { key: 'OTHERS', label: 'Others', type: 'num' },
      { key: 'NET_AMT', label: 'Net Amt', type: 'num' },
    ],
    excelExportColumns: [
      { key: 'CODE', label: 'Code' },
      { key: 'NAME', label: 'Name' },
      { key: 'ADD1', label: 'Add1' },
      { key: 'ADD2', label: 'Add2' },
      { key: 'ADD3', label: 'Add3' },
      { key: 'CITY', label: 'City' },
      { key: 'PAN', label: 'Pan' },
      { key: 'GST_NO', label: 'Gst No' },
      { key: 'BILL_DATE', label: 'Bill Date' },
      { key: 'BILL_NO', label: 'Bill No' },
      { key: 'BILL_AMT', label: 'Bill Amt' },
      { key: 'RET_AMT', label: 'Ret Amt' },
      { key: 'INT_AMT', label: 'Int Amt' },
      { key: 'CASH_PMT', label: 'Cash Pmt' },
      { key: 'CHQ_PMT', label: 'Chq Pmt' },
      { key: 'OTHERS', label: 'Others' },
      { key: 'NET_AMT', label: 'Net Amt' },
    ],
  },
};

export const INCOME_TAX_FILTER_LABELS = {
  sdt: 'Starting Date',
  edt: 'Ending Date',
  minAmt: 'Minimum Amount',
  topN: 'Top Number',
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

export const INCOME_TAX_FILTER_HINTS = {
  scheduleNo: 'Enter schedule number (e.g. 16.1). Leave 0 or blank to include all schedules.',
  spNo: 'Schedule filter — enter a number or 0 for all schedules.',
  minAmt: 'Show parties with total amount above this value.',
  topN: 'How many top parties to show by sales amount (default 10).',
  stateCode: 'Filter by state code from master (optional).',
  scode: 'Party or supplier account code (required for some reports).',
  icode: 'Item code filter (optional).',
  mdc: 'D = debit-balance accounts only, C = credit-balance accounts only, blank = all accounts.',
  mru: 'R = with GST, U = without GST, blank = all.',
};

export function getIncomeTaxReportDef(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return INCOME_TAX_REPORT_DEFS[id] || { filters: ['sdt', 'edt'] };
}

/** @param {string} reportId @param {string} filterKey */
export function resolveIncomeTaxFilterMeta(reportId, filterKey) {
  const def = getIncomeTaxReportDef(reportId);
  const override = def?.filterOverrides?.[filterKey] || {};
  return {
    label: override.label || INCOME_TAX_FILTER_LABELS[filterKey] || humanizeColumnKey(filterKey),
    hint: override.hint !== undefined ? override.hint : INCOME_TAX_FILTER_HINTS[filterKey],
    pickList: override.pickList || null,
    defaultValue: override.defaultValue != null ? String(override.defaultValue).trim() : '',
    required: override.required === true,
  };
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

export function isIncomeTaxGrandTotalRow(row) {
  return (
    Boolean(row?._isGrandTotal) ||
    String(row?.CMTH ?? row?.cmth ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.R_DATE ?? row?.r_date ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.BILL_DATE ?? row?.bill_date ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.ITEM_NAME ?? row?.item_name ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.ITEM_CAT ?? row?.item_cat ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.NAME ?? row?.name ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.BNAME ?? row?.bname ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.VR_DATE ?? row?.vr_date ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.B_NO ?? row?.b_no ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.BILL_NO ?? row?.bill_no ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.DC_CODE ?? row?.dc_code ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.FROM_TO ?? row?.from_to ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(row?.DETAIL ?? row?.detail ?? '').toUpperCase().includes('GRAND TOTAL')
  );
}

export function isIncomeTaxBillTotalRow(row) {
  return (
    Boolean(row?._isBillTotal) ||
    String(row?.B_NO ?? row?.b_no ?? '').toUpperCase() === 'B.NO TOTAL'
  );
}

export function isIncomeTaxLotRateTotalRow(row) {
  if (Boolean(row?._isLotRateTotal)) return true;
  const fields = ['ITEM_NAME', 'LOT', 'BILL_NO'];
  return fields.some((k) => {
    const v = String(row?.[k] ?? row?.[k?.toLowerCase?.()] ?? '').toUpperCase();
    return v === 'LOT/RATE TOTAL' || v === 'LOT RATE TOTAL';
  });
}

export function isIncomeTaxItemTotalRow(row) {
  if (Boolean(row?._isItemTotal)) return true;
  const fields = ['CMTH', 'NAME', 'ITEM_NAME'];
  return fields.some((k) => {
    const v = String(row?.[k] ?? row?.[k?.toLowerCase?.()] ?? '').toUpperCase();
    return v === 'ITEM TOTAL' || v === 'ITEM CAT TOTAL';
  });
}

export function isIncomeTaxBrokerTotalRow(row) {
  if (Boolean(row?._isBrokerTotal)) return true;
  const fields = ['CMTH', 'NAME', 'ITEM_NAME'];
  return fields.some((k) => {
    const v = String(row?.[k] ?? row?.[k?.toLowerCase?.()] ?? '').toUpperCase();
    return v === 'BROKER TOTAL';
  });
}

export function isIncomeTaxPartyTotalRow(row) {
  if (Boolean(row?._isPartyTotal)) return true;
  const fields = ['CMTH', 'R_DATE', 'BILL_DATE', 'ITEM_NAME', 'DC_CODE', 'NAME', 'VR_DATE'];
  return fields.some((k) => {
    const v = String(row?.[k] ?? row?.[k?.toLowerCase?.()] ?? '').toUpperCase();
    return (
      v === 'PARTY TOTAL' ||
      v === 'SUPPLIER TOTAL' ||
      v === 'CODE TOTAL' ||
      v === 'CITY TOTAL' ||
      v === 'ACCOUNT TOTAL'
    );
  });
}

export function formatPartyGroupLabel(row) {
  const code = String(
    row.BK_CODE ?? row.bk_code ?? row.SUP_CODE ?? row.sup_code ?? row.CODE ?? row.code ?? ''
  ).trim();
  const name = String(
    row.BNAME ?? row.bname ?? row.BK_NAME ?? row.bk_name ?? row.NAME ?? row.name ?? ''
  ).trim();
  if (code && name) return `${code} — ${name}`;
  return code || name || 'Party';
}

export function formatItemCatGroupLabel(row) {
  const cat = String(row.ITEM_CAT ?? row.item_cat ?? '').trim();
  return cat || 'Item Category';
}

export function formatItemGroupLabel(row) {
  const code = String(row.ITEM_CODE ?? row.item_code ?? '').trim();
  const name = String(row.ITEM_NAME ?? row.item_name ?? '').trim();
  if (code && name) return `${code} — ${name}`;
  if (code) return code;
  if (name) return name;
  return 'Item';
}

export function formatItemCodeGroupLabel(row) {
  return String(row.ITEM_CODE ?? row.item_code ?? '').trim() || 'Item';
}

export function formatBrokerGroupLabel(row) {
  const code = String(row.BK_CODE ?? row.bk_code ?? '').trim();
  const name = String(row.BNAME ?? row.bname ?? row.BK_NAME ?? row.bk_name ?? '').trim();
  if (code && name) return `${code} — ${name}`;
  return code || name || 'Broker';
}

export function formatCityGroupLabel(row) {
  const city = String(row.CITY ?? row.city ?? '').trim();
  return city ? `City: ${city}` : 'City';
}

export function formatStateCityGroupLabel(row) {
  const stateCode = String(row.STATE_CODE ?? row.state_code ?? '').trim();
  const state = String(row.STATE ?? row.state ?? '').trim();
  const city = String(row.CITY ?? row.city ?? '').trim();
  const parts = [];
  if (stateCode) parts.push(stateCode);
  if (state) parts.push(state);
  if (city) parts.push(city);
  return parts.join('  ') || 'Station';
}

/** @param {string} key */
export function resolveItaxGroupLabelFn(key) {
  switch (String(key || '').trim()) {
    case 'itemCat':
      return formatItemCatGroupLabel;
    case 'itemCode':
      return formatItemCodeGroupLabel;
    case 'broker':
      return formatBrokerGroupLabel;
    case 'city':
      return formatCityGroupLabel;
    case 'stateCity':
      return formatStateCityGroupLabel;
    default:
      return undefined;
  }
}

export function formatBillGroupLabel(row) {
  const bno = String(row.B_NO ?? row.b_no ?? '').trim();
  return bno ? `B.No ${bno}` : 'B.No';
}

const LOT_BILL_DERIVED_TOTAL_KEYS = new Set(['BAL_QTY', 'BAL_WGT', 'AVG_RATE', 'BAL_AMOUNT', 'RATE']);

/** B.No group totals: balance qty/wt, weighted avg purchase rate, balance amount. */
export function computeLotBillGroupTotals(groupRows) {
  const sumKey = (k) =>
    groupRows.reduce((s, r) => {
      const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);

  const rQty = sumKey('R_QNTY');
  const sQty = sumKey('S_QNTY');
  const rWgt = sumKey('R_WEIGHT');
  const sWgt = sumKey('S_WEIGHT');
  const balQty = rQty - sQty;
  const balWgt = rWgt - sWgt;

  const rAmt = groupRows.reduce((s, r) => {
    const rq = Number(r.R_QNTY ?? r.r_qnty ?? 0);
    const amt = Number(r.AMOUNT ?? r.amount ?? 0);
    return s + (rq > 0 && Number.isFinite(amt) ? amt : 0);
  }, 0);

  const avgRate = rQty > 0 ? rAmt / rQty : 0;
  const balAmount = balWgt * avgRate;

  return {
    BAL_QTY: balQty,
    BAL_WGT: balWgt,
    AVG_RATE: avgRate,
    BAL_AMOUNT: balAmount,
    RATE: '',
  };
}

/** Group item+month rows: item header once, month lines, item subtotal, then grand total. */
export function buildItemMonthGroupedRows(rows, displayColumns, opts = {}) {
  const groupKeys = opts.groupKeys ?? ['ITEM_CODE', 'ITEM_NAME'];
  const hideKeys = new Set(opts.hideInDataKeys ?? groupKeys);
  const subtotalLabelKey = opts.subtotalLabelKey ?? 'CMTH';
  const subtotalLabel = opts.subtotalLabel ?? 'ITEM TOTAL';
  const labelFn = opts.labelFn ?? formatItemGroupLabel;
  const numKeys = displayColumns.filter((c) => c.type === 'num').map((c) => c.key);

  const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const out = [];
  let i = 0;

  while (i < dataRows.length) {
    const row = dataRows[i];
    const gk = groupKeys.map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '')).join('\0');
    const groupRows = [];
    while (i < dataRows.length) {
      const r = dataRows[i];
      const rk = groupKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
      if (rk !== gk) break;
      groupRows.push(r);
      i++;
    }

    out.push({
      _type: 'group',
      _id: `grp-${gk}-${out.length}`,
      label: labelFn(row),
    });

    for (const gr of groupRows) {
      const displayRow = { _type: 'data', ...gr, _id: gr._id ?? `row-${out.length}` };
      for (const hk of hideKeys) {
        displayRow[hk] = '';
      }
      out.push(displayRow);
    }

    const subtotal = {
      _type: 'subtotal',
      _isItemTotal: true,
      _id: `sub-${gk}-${out.length}`,
      [subtotalLabelKey]: subtotalLabel,
    };
    for (const hk of hideKeys) subtotal[hk] = '';
    for (const k of numKeys) {
      subtotal[k] = groupRows.reduce((s, r) => {
        const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    out.push(subtotal);
  }

  for (const gt of grandRows) {
    out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
  }
  return out;
}

/** Group item → party → month rows: item header, party header, month lines, party total, item total, grand total. */
export function buildItemPartyMonthGroupedRows(rows, displayColumns, opts = {}) {
  const itemKeys = opts.itemGroupKeys ?? ['ITEM_CODE', 'ITEM_NAME'];
  const partyKeys = opts.partyGroupKeys ?? ['CODE'];
  const itemHideKeys = new Set(opts.itemHideKeys ?? ['ITEM_CODE', 'ITEM_NAME']);
  const partyHideKeys = new Set(
    opts.partyHideKeys ?? ['CODE', 'NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO']
  );
  const subtotalLabelKey = opts.subtotalLabelKey ?? 'CMTH';
  const itemLabelFn = opts.itemLabelFn ?? formatItemGroupLabel;
  const partyLabelFn = opts.partyLabelFn ?? formatPartyGroupLabel;
  const partyHeaderType = opts.partyHeaderType ?? 'partyGroup';
  const partySubtotalLabel = opts.partySubtotalLabel ?? 'PARTY TOTAL';
  const itemSubtotalLabel = opts.itemSubtotalLabel ?? 'ITEM TOTAL';
  const numKeys = displayColumns.filter((c) => c.type === 'num').map((c) => c.key);

  const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const out = [];
  let i = 0;

  const sumRows = (list) => {
    const sub = { [subtotalLabelKey]: '' };
    for (const hk of itemHideKeys) sub[hk] = '';
    for (const hk of partyHideKeys) sub[hk] = '';
    for (const k of numKeys) {
      sub[k] = list.reduce((s, r) => {
        const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    return sub;
  };

  while (i < dataRows.length) {
    const itemRow = dataRows[i];
    const itemGk = itemKeys.map((k) => String(itemRow[k] ?? itemRow[k?.toLowerCase?.()] ?? '')).join('\0');
    const itemBlock = [];
    while (i < dataRows.length) {
      const r = dataRows[i];
      const ik = itemKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
      if (ik !== itemGk) break;
      itemBlock.push(r);
      i++;
    }

    out.push({
      _type: 'group',
      _id: `igrp-${itemGk}-${out.length}`,
      label: itemLabelFn(itemRow),
    });

    let j = 0;
    while (j < itemBlock.length) {
      const partyRow = itemBlock[j];
      const partyGk = partyKeys.map((k) => String(partyRow[k] ?? partyRow[k?.toLowerCase?.()] ?? '')).join('\0');
      const partyLines = [];
      while (j < itemBlock.length) {
        const r = itemBlock[j];
        const pk = partyKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
        if (pk !== partyGk) break;
        partyLines.push(r);
        j++;
      }

      if (partyHeaderType === 'group') {
        out.push({
          _type: 'group',
          _id: `ipgrp-${itemGk}-${partyGk}-${out.length}`,
          label: partyLabelFn(partyRow),
        });
      } else {
        out.push({
          _type: 'partyGroup',
          _id: `ipgrp-${itemGk}-${partyGk}-${out.length}`,
          label: partyLabelFn(partyRow),
          partyRow: { ...partyRow },
        });
      }

      for (const line of partyLines) {
        const displayRow = { _type: 'data', ...line, _id: line._id ?? `row-${out.length}` };
        for (const hk of itemHideKeys) displayRow[hk] = '';
        for (const hk of partyHideKeys) displayRow[hk] = '';
        out.push(displayRow);
      }

      out.push({
        _type: 'subtotal',
        _isPartyTotal: true,
        _id: `ipsub-${itemGk}-${partyGk}-${out.length}`,
        ...sumRows(partyLines),
        [subtotalLabelKey]: partySubtotalLabel,
      });
    }

    out.push({
      _type: 'subtotal',
      _isItemTotal: true,
      _id: `isub-${itemGk}-${out.length}`,
      ...sumRows(itemBlock),
      [subtotalLabelKey]: itemSubtotalLabel,
    });
  }

  for (const gt of grandRows) {
    out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
  }
  return out;
}

/** Chant reports — supplier / item / lot-rate grouping with subtotals and grand total. */
export function buildChantGroupedRows(rows, displayColumns, opts = {}) {
  const mode = opts.mode ?? 'lotRate';

  if (mode === 'summary') {
    const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
    const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
    const out = [];
    const dateMap = new Map();
    const dateSortKey = (row) => String(row.BILL_DATE ?? row.bill_date ?? '');
    for (const row of dataRows) {
      const dk = dateSortKey(row);
      if (!dateMap.has(dk)) dateMap.set(dk, []);
      dateMap.get(dk).push(row);
    }
    for (const dateGk of [...dateMap.keys()].sort()) {
      const sample = dateMap.get(dateGk)[0];
      const dateLabel =
        formatLedgerDateDisplay(sample?.BILL_DATE ?? sample?.bill_date ?? dateGk) || dateGk || 'Date';
      out.push({
        _type: 'group',
        _id: `chant-date-${dateGk}-${out.length}`,
        label: dateLabel,
      });
      const inner = buildChantGroupedRows(dateMap.get(dateGk), displayColumns, {
        ...opts,
        mode: 'item',
        skipPartyGroupHeader: true,
        skipItemGroupHeader: true,
        supplierHideKeys: [],
        itemHideKeys: [],
      });
      out.push(...inner);
    }
    for (const gt of grandRows) {
      out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
    }
    return out;
  }

  const skipPartyGroupHeader = Boolean(opts.skipPartyGroupHeader);
  const skipItemGroupHeader = Boolean(opts.skipItemGroupHeader);
  const supplierKeys = opts.supplierGroupKeys ?? ['SUP_CODE'];
  const itemKeys = opts.itemGroupKeys ?? ['ITEM_CODE', 'ITEM_NAME'];
  const lotRateKeys = opts.lotRateGroupKeys ?? ['LOT', 'RATE'];
  const supplierHideKeys = new Set(opts.supplierHideKeys ?? ['SUP_CODE', 'NAME']);
  const itemHideKeys = new Set(opts.itemHideKeys ?? ['ITEM_CODE', 'ITEM_NAME']);
  const lotRateHideKeys = new Set(opts.lotRateHideKeys ?? ['LOT', 'RATE']);
  const lotRateSubtotalLabel = opts.lotRateSubtotalLabel ?? 'LOT/RATE TOTAL';
  const itemSubtotalLabel = opts.itemSubtotalLabel ?? 'ITEM TOTAL';
  const supplierSubtotalLabel = opts.supplierSubtotalLabel ?? 'SUPPLIER TOTAL';
  const lotRateLabelKey = opts.lotRateSubtotalLabelKey ?? 'ITEM_NAME';
  const itemSubtotalLabelKey = opts.itemSubtotalLabelKey ?? 'ITEM_NAME';
  const supplierSubtotalLabelKey = opts.supplierSubtotalLabelKey ?? 'NAME';
  const numKeys = displayColumns.filter((c) => c.type === 'num').map((c) => c.key);

  const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const out = [];

  const rowKey = (r, keys) => keys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');

  const sumRows = (list) => {
    const sub = {};
    for (const hk of supplierHideKeys) sub[hk] = '';
    for (const hk of itemHideKeys) sub[hk] = '';
    for (const hk of lotRateHideKeys) sub[hk] = '';
    for (const k of numKeys) {
      sub[k] = list.reduce((s, r) => {
        const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    return sub;
  };

  const sortDetailLines = (list) =>
    [...list].sort((a, b) => {
      const ad = String(a.BILL_DATE ?? a.bill_date ?? '');
      const bd = String(b.BILL_DATE ?? b.bill_date ?? '');
      if (ad !== bd) return ad.localeCompare(bd);
      const an = String(a.NAME ?? a.name ?? '');
      const bn = String(b.NAME ?? b.name ?? '');
      if (an !== bn) return an.localeCompare(bn);
      const aic = String(a.ITEM_CODE ?? a.item_code ?? '');
      const bic = String(b.ITEM_CODE ?? b.item_code ?? '');
      if (aic !== bic) return aic.localeCompare(bic, undefined, { numeric: true });
      const al = String(a.LOT ?? a.lot ?? '');
      const bl = String(b.LOT ?? b.lot ?? '');
      if (al !== bl) return al.localeCompare(bl);
      const ar = Number(a.RATE ?? a.rate ?? 0);
      const br = Number(b.RATE ?? b.rate ?? 0);
      if (ar !== br) return ar - br;
      const abn = String(a.BILL_NO ?? a.bill_no ?? '');
      const bbn = String(b.BILL_NO ?? b.bill_no ?? '');
      return abn.localeCompare(bbn, undefined, { numeric: true });
    });

  const supplierMap = new Map();
  for (const row of dataRows) {
    const supplierGk = rowKey(row, supplierKeys);
    if (!supplierMap.has(supplierGk)) {
      supplierMap.set(supplierGk, { sample: row, lines: [], items: new Map() });
    }
    const supplierEntry = supplierMap.get(supplierGk);
    supplierEntry.lines.push(row);
    const itemGk = rowKey(row, itemKeys);
    if (!supplierEntry.items.has(itemGk)) {
      supplierEntry.items.set(itemGk, { sample: row, lotRates: new Map(), lines: [] });
    }
    const itemEntry = supplierEntry.items.get(itemGk);
    itemEntry.lines.push(row);
    const lotRateGk = rowKey(row, lotRateKeys);
    if (!itemEntry.lotRates.has(lotRateGk)) {
      itemEntry.lotRates.set(lotRateGk, []);
    }
    itemEntry.lotRates.get(lotRateGk).push(row);
  }

  const supplierOrder = [...supplierMap.entries()].sort(([, a], [, b]) => {
    const an = String(a.sample.NAME ?? a.sample.name ?? '');
    const bn = String(b.sample.NAME ?? b.sample.name ?? '');
    if (an !== bn) return an.localeCompare(bn);
    return rowKey(a.sample, supplierKeys).localeCompare(rowKey(b.sample, supplierKeys));
  });

  for (const [supplierGk, supplierEntry] of supplierOrder) {
    const supplierRow = supplierEntry.sample;

    if (!skipPartyGroupHeader) {
      out.push({
        _type: 'partyGroup',
        _id: `chant-sup-${supplierGk}-${out.length}`,
        label: formatPartyGroupLabel(supplierRow),
        partyRow: { ...supplierRow },
      });
    }

    if (mode === 'supplier') {
      const sortedLines = sortDetailLines(supplierEntry.lines);
      for (const line of sortedLines) {
        const displayRow = { _type: 'data', ...line, _id: line._id ?? `row-${out.length}` };
        for (const hk of supplierHideKeys) displayRow[hk] = '';
        out.push(displayRow);
      }
      out.push({
        _type: 'subtotal',
        _isPartyTotal: true,
        _id: `chant-ssub-${supplierGk}-${out.length}`,
        ...sumRows(sortedLines),
        [supplierSubtotalLabelKey]: supplierSubtotalLabel,
      });
      continue;
    }

    const itemOrder = [...supplierEntry.items.entries()].sort(([, a], [, b]) =>
      rowKey(a.sample, itemKeys).localeCompare(rowKey(b.sample, itemKeys))
    );

    for (const [itemGk, itemEntry] of itemOrder) {
      const itemRow = itemEntry.sample;

      if (!skipItemGroupHeader) {
        out.push({
          _type: 'group',
          _id: `chant-item-${supplierGk}-${itemGk}-${out.length}`,
          label: formatItemGroupLabel(itemRow),
        });
      }

      if (mode === 'item') {
        const sortedLines = sortDetailLines(itemEntry.lines);
        for (const line of sortedLines) {
          const displayRow = { _type: 'data', ...line, _id: line._id ?? `row-${out.length}` };
          for (const hk of supplierHideKeys) displayRow[hk] = '';
          for (const hk of itemHideKeys) displayRow[hk] = '';
          out.push(displayRow);
        }
        out.push({
          _type: 'subtotal',
          _isItemTotal: true,
          _id: `chant-isub-${supplierGk}-${itemGk}-${out.length}`,
          ...sumRows(sortedLines),
          [itemSubtotalLabelKey]: itemSubtotalLabel,
        });
        continue;
      }

      const lotRateOrder = [...itemEntry.lotRates.entries()].sort(([aKey], [bKey]) => {
        const [aLot = '', aRate = ''] = aKey.split('\0');
        const [bLot = '', bRate = ''] = bKey.split('\0');
        if (aLot !== bLot) return aLot.localeCompare(bLot);
        return Number(aRate) - Number(bRate);
      });

      for (const [lotRateGk, lotRateLines] of lotRateOrder) {
        const sortedLines = sortDetailLines(lotRateLines);
        for (const line of sortedLines) {
          const displayRow = { _type: 'data', ...line, _id: line._id ?? `row-${out.length}` };
          for (const hk of supplierHideKeys) displayRow[hk] = '';
          for (const hk of itemHideKeys) displayRow[hk] = '';
          out.push(displayRow);
        }
        out.push({
          _type: 'subtotal',
          _isLotRateTotal: true,
          _id: `chant-lr-${supplierGk}-${itemGk}-${lotRateGk}-${out.length}`,
          ...sumRows(sortedLines),
          [lotRateLabelKey]: lotRateSubtotalLabel,
        });
      }

      out.push({
        _type: 'subtotal',
        _isItemTotal: true,
        _id: `chant-isub-${supplierGk}-${itemGk}-${out.length}`,
        ...sumRows(itemEntry.lines),
        [itemSubtotalLabelKey]: itemSubtotalLabel,
      });
    }

    out.push({
      _type: 'subtotal',
      _isPartyTotal: true,
      _id: `chant-ssub-${supplierGk}-${out.length}`,
      ...sumRows(supplierEntry.lines),
      [supplierSubtotalLabelKey]: supplierSubtotalLabel,
    });
  }

  for (const gt of grandRows) {
    out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
  }
  return out;
}

export function buildChantFormat1GroupedRows(rows, displayColumns, opts = {}) {
  return buildChantGroupedRows(rows, displayColumns, { ...opts, mode: 'lotRate' });
}

/** Group broker → item → bill lines with item and broker subtotals, then grand total. */
export function buildBrokerItemGroupedRows(rows, displayColumns, opts = {}) {
  const brokerKeys = opts.brokerGroupKeys ?? ['BK_CODE'];
  const itemKeys = opts.itemGroupKeys ?? ['ITEM_CODE', 'ITEM_NAME'];
  const brokerHideKeys = new Set(opts.brokerHideKeys ?? ['BK_CODE', 'BNAME']);
  const itemHideKeys = new Set(opts.itemHideKeys ?? ['ITEM_CODE', 'ITEM_NAME']);
  const subtotalLabelKey = opts.subtotalLabelKey ?? 'NAME';
  const brokerSubtotalLabel = opts.brokerSubtotalLabel ?? 'BROKER TOTAL';
  const itemSubtotalLabel = opts.itemSubtotalLabel ?? 'ITEM TOTAL';
  const skipItemSubtotal = opts.skipItemSubtotal === true;
  const itemLabelFn = opts.itemLabelFn ?? formatItemGroupLabel;
  const numKeys = displayColumns.filter((c) => c.type === 'num').map((c) => c.key);

  const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const out = [];

  const sumRows = (list) => {
    const sub = { [subtotalLabelKey]: '' };
    for (const hk of brokerHideKeys) sub[hk] = '';
    for (const hk of itemHideKeys) sub[hk] = '';
    for (const k of numKeys) {
      sub[k] = list.reduce((s, r) => {
        const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    return sub;
  };

  let i = 0;
  while (i < dataRows.length) {
    const brokerRow = dataRows[i];
    const brokerGk = brokerKeys.map((k) => String(brokerRow[k] ?? brokerRow[k?.toLowerCase?.()] ?? '')).join('\0');
    const brokerBlock = [];
    while (i < dataRows.length) {
      const r = dataRows[i];
      const bk = brokerKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
      if (bk !== brokerGk) break;
      brokerBlock.push(r);
      i++;
    }

    out.push({
      _type: 'partyGroup',
      _id: `bgrp-${brokerGk}-${out.length}`,
      label: formatPartyGroupLabel(brokerRow),
      partyRow: { ...brokerRow },
    });

    let j = 0;
    while (j < brokerBlock.length) {
      const itemRow = brokerBlock[j];
      const itemGk = itemKeys.map((k) => String(itemRow[k] ?? itemRow[k?.toLowerCase?.()] ?? '')).join('\0');
      const itemLines = [];
      while (j < brokerBlock.length) {
        const r = brokerBlock[j];
        const ik = itemKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
        if (ik !== itemGk) break;
        itemLines.push(r);
        j++;
      }

      if (!skipItemSubtotal) {
        out.push({
          _type: 'group',
          _id: `bigrp-${brokerGk}-${itemGk}-${out.length}`,
          label: itemLabelFn(itemRow),
        });
      }

      for (const line of itemLines) {
        const displayRow = { _type: 'data', ...line, _id: line._id ?? `row-${out.length}` };
        if (!skipItemSubtotal) {
          for (const hk of brokerHideKeys) displayRow[hk] = '';
          for (const hk of itemHideKeys) displayRow[hk] = '';
        }
        out.push(displayRow);
      }

      if (!skipItemSubtotal) {
        out.push({
          _type: 'subtotal',
          _isItemTotal: true,
          _id: `bisub-${brokerGk}-${itemGk}-${out.length}`,
          ...sumRows(itemLines),
          [subtotalLabelKey]: itemSubtotalLabel,
        });
      }
    }

    out.push({
      _type: 'subtotal',
      _isBrokerTotal: true,
      _id: `bsub-${brokerGk}-${out.length}`,
      ...sumRows(brokerBlock),
      [subtotalLabelKey]: brokerSubtotalLabel,
    });
  }

  for (const gt of grandRows) {
    out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
  }
  return out;
}

/** Group bill rows: B.No header once, detail lines, B.No subtotal, then grand total. */
export function buildBillGroupedRows(rows, displayColumns, opts = {}) {
  const groupKeys = opts.groupKeys ?? ['B_NO'];
  const hideKeys = new Set(opts.hideInDataKeys ?? ['B_NO']);
  const subtotalLabelKey = opts.subtotalLabelKey ?? 'B_NO';
  const subtotalLabel = opts.subtotalLabel ?? 'B.NO TOTAL';
  const labelFn = opts.labelFn ?? formatBillGroupLabel;
  const billBalanceTotals = Boolean(opts.billBalanceTotals);
  const numKeys = displayColumns.filter((c) => c.type === 'num').map((c) => c.key);
  const sumKeys = billBalanceTotals
    ? numKeys.filter((k) => !LOT_BILL_DERIVED_TOTAL_KEYS.has(k))
    : numKeys;

  const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const out = [];
  let i = 0;

  while (i < dataRows.length) {
    const row = dataRows[i];
    const gk = groupKeys.map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '')).join('\0');
    const groupRows = [];
    while (i < dataRows.length) {
      const r = dataRows[i];
      const rk = groupKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
      if (rk !== gk) break;
      groupRows.push(r);
      i++;
    }

    out.push({
      _type: 'group',
      _id: `bgrp-${gk}-${out.length}`,
      label: labelFn(row),
    });

    for (const gr of groupRows) {
      const displayRow = { _type: 'data', ...gr, _id: gr._id ?? `row-${out.length}` };
      for (const hk of hideKeys) {
        displayRow[hk] = '';
      }
      out.push(displayRow);
    }

    const subtotal = {
      _type: 'subtotal',
      _isBillTotal: true,
      _id: `bsub-${gk}-${out.length}`,
      [subtotalLabelKey]: subtotalLabel,
    };
    for (const hk of hideKeys) subtotal[hk] = '';
    for (const k of sumKeys) {
      subtotal[k] = groupRows.reduce((s, r) => {
        const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    if (billBalanceTotals) {
      Object.assign(subtotal, computeLotBillGroupTotals(groupRows));
    }
    out.push(subtotal);
  }

  for (const gt of grandRows) {
    out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
  }
  return out;
}

/** Group party+bill rows: party header once, bill lines, party subtotal, then grand total. */
export function buildPartyBillGroupedRows(rows, displayColumns, opts = {}) {
  const groupKeys = opts.groupKeys ?? ['SUP_CODE'];
  const hideKeys = new Set(opts.hideInDataKeys ?? ['NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO']);
  const blankRepeatKeys = new Set(opts.blankRepeatInDataKeys ?? []);
  const suppressPartyHeader = opts.suppressPartyHeader === true;
  const subtotalLabelKey = opts.subtotalLabelKey ?? 'R_DATE';
  const subtotalLabel = opts.subtotalLabel ?? 'PARTY TOTAL';
  const numKeys = displayColumns.filter((c) => c.type === 'num').map((c) => c.key);

  const grandRows = rows.filter(isIncomeTaxGrandTotalRow);
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const out = [];
  let i = 0;

  while (i < dataRows.length) {
    const row = dataRows[i];
    const gk = groupKeys.map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '')).join('\0');
    const groupRows = [];
    while (i < dataRows.length) {
      const r = dataRows[i];
      const rk = groupKeys.map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '')).join('\0');
      if (rk !== gk) break;
      groupRows.push(r);
      i++;
    }

    if (!suppressPartyHeader) {
      out.push({
        _type: 'partyGroup',
        _id: `pgrp-${gk}-${out.length}`,
        label: formatPartyGroupLabel(row),
        partyRow: { ...row },
      });
    }

    groupRows.forEach((gr, idx) => {
      const displayRow = { _type: 'data', ...gr, _id: gr._id ?? `row-${out.length}` };
      for (const hk of hideKeys) {
        displayRow[hk] = '';
      }
      if (idx > 0) {
        for (const hk of blankRepeatKeys) {
          displayRow[hk] = '';
        }
      }
      out.push(displayRow);
    });

    const subtotal = {
      _type: 'subtotal',
      _isPartyTotal: true,
      _id: `psub-${gk}-${out.length}`,
      [subtotalLabelKey]: subtotalLabel,
    };
    for (const hk of hideKeys) {
      if (hk !== subtotalLabelKey) subtotal[hk] = '';
    }
    for (const hk of blankRepeatKeys) {
      if (hk !== subtotalLabelKey) subtotal[hk] = '';
    }
    for (const k of numKeys) {
      subtotal[k] = groupRows.reduce((s, r) => {
        const n = Number(r[k] ?? r[k?.toLowerCase?.()]);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
    out.push(subtotal);
  }

  for (const gt of grandRows) {
    out.push({ _type: 'data', ...gt, _id: gt._id ?? 'grand-total' });
  }
  return out;
}

export function ensureIncomeTaxGrandTotalRows(rows, displayColumns, { enabled = false, labelKey = 'CMTH' } = {}) {
  if (!enabled || !rows?.length || !displayColumns?.length) return rows ?? [];
  if (rows.some(isIncomeTaxGrandTotalRow)) return rows;
  const numCols = displayColumns.filter((c) => c.type === 'num');
  if (!numCols.length) return rows;
  const dataRows = rows.filter((r) => !isIncomeTaxGrandTotalRow(r));
  const total = {
    [labelKey]: 'GRAND TOTAL',
    _isGrandTotal: true,
    _id: `grand-total-${rows.length}`,
  };
  for (const c of numCols) {
    const key = c.key;
    total[key] = dataRows.reduce((s, r) => {
      const n = Number(r[key] ?? r[key?.toLowerCase?.()]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
  }
  return [...rows, total];
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

/** Full party header for Excel — code, name, address, PAN, GST (matches on-screen party group header). */
export function partyGroupExportText(row, { minimal = false } = {}) {
  const code = String(row.SUP_CODE ?? row.sup_code ?? row.CODE ?? row.code ?? '').trim();
  const name = String(row.NAME ?? row.name ?? '').trim();
  const head = [code, name].filter(Boolean).join(' ');
  if (minimal) return head;
  const subs = ['ADD1', 'ADD2', 'ADD3', 'CITY', 'PAN', 'GST_NO']
    .map((k) => String(row[k] ?? row[k?.toLowerCase?.()] ?? '').trim())
    .filter(Boolean);
  return [head, ...subs].filter(Boolean).join('\n');
}

export function emptyPartyExcelCols({ broker = false } = {}) {
  if (broker) {
    return {
      'Broker Code': '',
      'Broker Name': '',
    };
  }
  return {
    'Party Code': '',
    'Party Name': '',
    Add1: '',
    Add2: '',
    City: '',
    Pan: '',
    'Gst No': '',
  };
}

/** Party columns for Excel export (party-group reports). */
export function partyRowToExcelCols(row, { minimal = false, broker = false } = {}) {
  const bkCode = String(row.BK_CODE ?? row.bk_code ?? '').trim();
  const isBroker = broker || Boolean(bkCode);
  if (isBroker) {
    return {
      'Broker Code': bkCode,
      'Broker Name': String(row.BNAME ?? row.bname ?? row.BK_NAME ?? row.bk_name ?? '').trim(),
    };
  }
  const code = String(row.SUP_CODE ?? row.sup_code ?? row.CODE ?? row.code ?? '').trim();
  return {
    'Party Code': code,
    'Party Name': String(row.NAME ?? row.name ?? '').trim(),
    Add1: minimal ? '' : String(row.ADD1 ?? row.add1 ?? '').trim(),
    Add2: minimal ? '' : String(row.ADD2 ?? row.add2 ?? '').trim(),
    City: minimal ? '' : String(row.CITY ?? row.city ?? '').trim(),
    Pan: minimal ? '' : String(row.PAN ?? row.pan ?? '').trim(),
    'Gst No': minimal ? '' : String(row.GST_NO ?? row.gst_no ?? '').trim(),
  };
}

export function compactTableColClass(col) {
  if (col.key === 'BK_CODE') return 'itax-col-broker-code';
  if (col.key === 'BNAME') return 'itax-col-bname';
  if (col.key === 'CODE' || col.key === 'ITEM_CODE' || col.key === 'SUP_CODE' || col.key === 'MSUP_CODE' || col.key === 'DC_CODE') {
    return 'itax-col-code';
  }
  if (col.key === 'B_NO' || col.key === 'BILL_NO') return 'itax-col-mth';
  if (col.key === 'LOT' || col.key === 'STATUS' || col.key === 'VR_NO' || col.key === 'VR_TYPE' || col.key === 'GOD_CODE') {
    return 'itax-col-text';
  }
  if (col.type === 'partyBlock' || col.key === 'NAME' || col.key === 'ITEM_NAME' || col.key === 'CUST_NAME' || col.key === 'MSUP_NAME') {
    return 'itax-col-name';
  }
  if (col.key === 'PAN') return 'itax-col-pan';
  if (col.key === 'CITY') return 'itax-col-city';
  if (col.key === 'GST_NO') return 'itax-col-gst';
  if (col.key === 'QNTY' || col.key === 'BAL_QTY' || col.key === 'BAL_WGT') return 'itax-col-qty';
  if (col.key === 'BAGS' || col.key === 'KATTA' || col.key === 'HKATTA') return 'itax-col-qty-sm';
  if (col.key === 'WEIGHT') return 'itax-col-amt';
  if (col.key === 'CMTH' || FISCAL_MONTH_KEYS.has(col.key) || col.key === 'OP' || col.key === 'TOT') return 'itax-col-mth';
  if (col.key === 'R_DATE' || col.type === 'date') return 'itax-col-date';
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
