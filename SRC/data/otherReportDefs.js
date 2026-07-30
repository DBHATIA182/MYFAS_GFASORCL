/**
 * Other Reports UI definitions — filters and columns per report id.
 * SQL/logic: server/otherReports.cjs (VFP labour.prg, broker.prg, etc.)
 */

import {
  humanizeColumnKey,
  ensureIncomeTaxGrandTotalRows,
  isIncomeTaxGrandTotalRow,
  isIncomeTaxPartyTotalRow,
  isIncomeTaxItemTotalRow,
  isIncomeTaxBillTotalRow,
  buildBrokerItemGroupedRows,
} from './incomeTaxReportDefs';

export {
  humanizeColumnKey,
  ensureIncomeTaxGrandTotalRows,
  isIncomeTaxGrandTotalRow,
  isIncomeTaxPartyTotalRow,
  isIncomeTaxItemTotalRow,
  isIncomeTaxBillTotalRow,
  buildBrokerItemGroupedRows,
};

const numCol = (key, label, decimals = 2) => ({ key, label, type: 'num', decimals });
const txtCol = (key, label) => ({ key, label, type: 'text' });
const dateCol = (key, label) => ({ key, label, type: 'date' });

const BROKER_REPORT_DETAIL_COLS = [
  dateCol('BILL_DATE', 'Date'),
  txtCol('BILL_NO', 'B.No.'),
  txtCol('NAME', 'Party Name'),
  numCol('BAGS', 'Bags'),
  numCol('KATTA', 'Katta'),
  numCol('HKATTA', 'H.Katta'),
  numCol('RATE', 'Rate'),
  numCol('WEIGHT', 'Weight'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROK_PER', 'Brk.Rate'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P.Amt.'),
  numCol('LINE_TOT', 'Total'),
  numCol('FREIGHT', 'Freight'),
];

const INSURANCE_DETAIL_COLS = [
  numCol('SR_NO', 'Sr.No.', 0),
  dateCol('BILL_DATE', 'Inv.Date'),
  txtCol('BILL_NO', 'Inv.No.'),
  numCol('BAGS', 'Bags', 0),
  numCol('WEIGHT', 'Weight', 3),
  numCol('INV_VALUE', 'Inv.Value'),
  numCol('AMOUNT', 'Amount'),
  numCol('INV_PLUS_10', 'Invoice+10%'),
  txtCol('TRUCK_NO', 'Truck No.'),
  txtCol('BILTY_NO', 'Bilty No.'),
  txtCol('FROM_TO', 'From To'),
];

const INSURANCE_SUMMARY_COLS = [
  dateCol('BILL_DATE', 'Date'),
  numCol('BAGS', 'Bags', 0),
  numCol('WEIGHT', 'Weight', 3),
  numCol('INV_VALUE', 'Inv.Value'),
  numCol('AMOUNT', 'Amount'),
  numCol('INV_PLUS_10', 'Invoice+10%'),
];

const INSURANCE_FILTER_OVERRIDES = {
  mcn: {
    label: 'Detail / Summary',
    pickList: [
      { value: 'D', label: 'Detail' },
      { value: 'S', label: 'Summary' },
    ],
    defaultValue: 'D',
  },
  rpttype: {
    label: 'Bill Type',
    pickList: [
      { value: '', label: 'All' },
      { value: 'S', label: 'Sale' },
      { value: 'C', label: 'Credit Note' },
    ],
  },
  mlc: {
    label: 'L / C',
    pickList: [
      { value: '', label: 'All' },
      { value: 'L', label: 'Local' },
      { value: 'C', label: 'Central' },
    ],
  },
};
const BROKER_REPORT_ENTRY_OVERRIDES = {
  sdt: { label: 'From Date' },
  edt: { label: 'To Date' },
  sbCode: {
    label: 'Broker From',
    manualCode: true,
    pickList: 'masterBroker',
    defaultValue: 'B00000',
  },
  ebCode: {
    label: 'Broker To',
    manualCode: true,
    pickList: 'masterBroker',
    defaultValue: 'B99999',
  },
  scode: {
    label: 'Supplier Code',
    manualCode: true,
    pickList: 'masterSupplier',
  },
  mcode: {
    label: 'Party Code',
    manualCode: true,
    pickList: 'masterCustomer',
  },
  icode: {
    label: 'Item Code',
    manualCode: true,
    pickList: 'itemMaster',
  },
  msp: { label: 'Sale/Pur.' },
  mds: { label: 'Detail/Sum.' },
};

const DALALI_EXCEL_ENTRY_OVERRIDES = {
  sdt: { label: 'From Date' },
  edt: { label: 'To Date' },
  sbCode: {
    label: 'Broker From',
    manualCode: true,
    pickList: 'masterBroker',
    defaultValue: 'B00000',
    hint: 'Broker range start (default B00000). Tap ? / F1 to search broker by code or name.',
  },
  ebCode: {
    label: 'Broker To',
    manualCode: true,
    pickList: 'masterBroker',
    defaultValue: 'B99999',
    hint: 'Broker range end (default B99999). Tap ? / F1 to search broker by code or name.',
  },
  scode: {
    label: 'Supplier Code',
    manualCode: true,
    pickList: 'masterSupplier',
    hint: 'Optional — tap ? / F1 to search supplier by code or name. Leave blank for all suppliers.',
  },
  mcode: {
    label: 'Party Code',
    manualCode: true,
    pickList: 'masterCustomer',
    hint: 'Optional — tap ? / F1 to search party/customer by code or name. Leave blank for all parties.',
  },
  icode: {
    label: 'Item Code',
    manualCode: true,
    pickList: 'itemMaster',
    hint: 'Optional — tap ? / F1 to search item by code or name. Leave blank for all items.',
  },
};

const BROKER_ITEM_CAT_ENTRY_OVERRIDES = {
  ...BROKER_REPORT_ENTRY_OVERRIDES,
  icat: {
    label: 'Item Category',
    hint: 'Optional item category code — leave blank for all categories.',
  },
  mlc: {
    label: 'L / C',
    pickList: [
      { value: '', label: 'All' },
      { value: 'L', label: 'Local' },
      { value: 'C', label: 'Central' },
    ],
  },
};

const BROKER_ITEM_CAT_SUMMARY_COLS = [
  txtCol('ITEM_CAT', 'Category'),
  numCol('BAGS', 'Bags'),
  numCol('KATTA', 'Katta'),
  numCol('HKATTA', 'H.Katta'),
  numCol('WEIGHT', 'Weight'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P.Amt.'),
  numCol('LINE_TOT', 'Total'),
  numCol('FREIGHT', 'Freight'),
];

const BROKER_ITEM_CAT_DETAIL_COLS = [
  dateCol('BILL_DATE', 'Date'),
  txtCol('BILL_NO', 'B.No.'),
  txtCol('NAME', 'Party Name'),
  txtCol('ITEM_NAME', 'Item Name'),
  numCol('BAGS', 'Bags'),
  numCol('KATTA', 'Katta'),
  numCol('HKATTA', 'H.Katta'),
  numCol('RATE', 'Rate'),
  numCol('WEIGHT', 'Weight'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROK_PER', 'Brk.Rate'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P.Amt.'),
  numCol('LINE_TOT', 'Total'),
  numCol('FREIGHT', 'Freight'),
];

const BROKER_ITEM_SUMMARY_COLS = [
  txtCol('ITEM_CODE', 'Item'),
  txtCol('ITEM_NAME', 'Item Name'),
  numCol('BAGS', 'Bags'),
  numCol('KATTA', 'Katta'),
  numCol('HKATTA', 'H.Katta'),
  numCol('WEIGHT', 'Weight'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P.Amt.'),
  numCol('LINE_TOT', 'Total'),
  numCol('FREIGHT', 'Freight'),
];

const BROKER_REPORT_GRAND_KEYS = ['BAGS', 'KATTA', 'HKATTA', 'WEIGHT', 'AMOUNT', 'BROKERAGE', 'DANE_AMT', 'P_AMT', 'LINE_TOT', 'FREIGHT'];

const BROKER_SUMMARY_LIST_COLS = [
  txtCol('BK_CODE', 'Broker'),
  txtCol('BNAME', 'Name'),
  numCol('BAGS', 'Bags'),
  numCol('KATTA', 'Katta'),
  numCol('HKATTA', 'H.Katta'),
  numCol('WEIGHT', 'Weight'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P.Amt.'),
  numCol('LINE_TOT', 'Total'),
  numCol('FREIGHT', 'Freight'),
];

const BROKER_SUMMARY_DRILL_COLS = [
  dateCol('BILL_DATE', 'Date'),
  txtCol('BILL_NO', 'B.No.'),
  txtCol('NAME', 'Party Name'),
  txtCol('ITEM_NAME', 'Item Name'),
  numCol('BAGS', 'Bags'),
  numCol('KATTA', 'Katta'),
  numCol('HKATTA', 'H.Katta'),
  numCol('RATE', 'Rate'),
  numCol('WEIGHT', 'Weight'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROK_PER', 'Brk.Rate'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P.Amt.'),
  numCol('LINE_TOT', 'Total'),
  numCol('FREIGHT', 'Freight'),
];

const TRADING_EXP_VOUCHER_DRILL_COLS = [
  txtCol('CODE', 'Code'),
  txtCol('NAME', 'Name'),
  txtCol('DETAIL', 'Detail'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
];

const BROKER_LEDGER_DRILL_COLS = [
  dateCol('VR_DATE', 'Date'),
  txtCol('VR_NO', 'No'),
  txtCol('VR_TYPE', 'Type'),
  txtCol('DETAIL', 'Detail'),
  numCol('DR_AMT', 'Debit'),
  numCol('CR_AMT', 'Credit'),
  txtCol('NAME', 'Name'),
];

const CHANT_ENTRY_OVERRIDES = {
  scode: {
    label: 'Supplier Code',
    pickList: 'masterSupplier',
    manualCode: true,
    hint: 'Optional — tap ? / F1 to search supplier (S/T accounts).',
  },
  icode: {
    label: 'Item Code',
    pickList: 'itemMaster',
    manualCode: true,
    hint: 'Optional — tap ? / F1 to search item by name or code.',
  },
  godCode: {
    label: 'Godown Code',
    pickList: 'godown',
    hint: 'Optional — tap ? to search godown by name or code.',
  },
  mSupCode: {
    label: 'Main Supplier Code',
    pickList: 'masterSupplier',
    manualCode: true,
    hint: 'Optional — main supplier (S/T accounts from master).',
  },
};

/** @deprecated alias */
const CHANT_FORMAT_1_ENTRY_OVERRIDES = CHANT_ENTRY_OVERRIDES;

const MONTH_OUTSTANDING_DRILL_COLS_PURCHASE = [
  dateCol('BILL_DATE', 'Bill Date'),
  txtCol('BILL_NO', 'Bill No'),
  txtCol('CODE', 'Code'),
  txtCol('NAME', 'Name'),
  dateCol('VR_DATE', 'Vr Date'),
  txtCol('VR_NO', 'Vr No'),
  txtCol('VR_TYPE', 'Type'),
  numCol('CR_AMT', 'Purchase'),
  numCol('DR_AMT', 'Payment'),
  txtCol('DETAIL', 'Detail'),
];

const MONTH_OUTSTANDING_DRILL_COLS_SALE = [
  dateCol('BILL_DATE', 'Bill Date'),
  txtCol('BILL_NO', 'Bill No'),
  txtCol('CODE', 'Code'),
  txtCol('NAME', 'Name'),
  dateCol('VR_DATE', 'Vr Date'),
  txtCol('VR_NO', 'Vr No'),
  txtCol('VR_TYPE', 'Type'),
  numCol('DR_AMT', 'Sale'),
  numCol('CR_AMT', 'Receipt'),
  txtCol('DETAIL', 'Detail'),
];

const CHANT_FORMAT_1_COLS = [
  dateCol('BILL_DATE', 'Date'),
  txtCol('BILL_NO', 'Bill'),
  txtCol('SUP_CODE', 'Sup'),
  txtCol('NAME', 'Name'),
  txtCol('ITEM_CODE', 'Item'),
  txtCol('ITEM_NAME', 'Item Name'),
  txtCol('LOT', 'Lot'),
  txtCol('STATUS', 'St'),
  numCol('QNTY', 'Qty'),
  numCol('WEIGHT', 'Wgt'),
  numCol('RATE', 'Rate'),
  numCol('AMOUNT', 'Amt'),
];

const CHANT_FORMAT_2_COLS = [
  dateCol('BILL_DATE', 'Date'),
  txtCol('BILL_NO', 'Bill'),
  txtCol('SUP_CODE', 'Sup'),
  txtCol('NAME', 'Name'),
  txtCol('ITEM_CODE', 'Item'),
  txtCol('ITEM_NAME', 'Item Name'),
  numCol('QNTY', 'Qty'),
  numCol('WEIGHT', 'Wgt'),
  numCol('AMOUNT', 'Amt'),
];

const CHANT_FORMAT_3_COLS = [
  dateCol('BILL_DATE', 'Date'),
  txtCol('BILL_NO', 'Bill'),
  txtCol('SUP_CODE', 'Sup'),
  txtCol('NAME', 'Name'),
  txtCol('ITEM_CODE', 'Item'),
  txtCol('ITEM_NAME', 'Item Name'),
  numCol('QNTY', 'Qty'),
  numCol('WEIGHT', 'Wgt'),
  numCol('AMOUNT', 'Amt'),
];

/** Chant Summary (CHANT BAHI / chant4.frx) — date header, account line, item/supplier totals. */
const CHANT_SUMMARY_COLS = [
  txtCol('NAME', 'Account'),
  txtCol('BILL_NO', 'Bill No'),
  txtCol('ITEM_NAME', 'Item Name'),
  txtCol('LOT', 'Lot'),
  txtCol('REMARKS', 'Remarks'),
  numCol('QNTY', 'Bags', 0),
  numCol('WEIGHT', 'Weight', 3),
  numCol('RATE', 'Rate'),
  numCol('AMOUNT', 'Amount'),
];

const BROKER_ITEM_COLS = [
  txtCol('BK_CODE', 'Broker'),
  txtCol('BNAME', 'Broker Name'),
  txtCol('ITEM_CODE', 'Item'),
  txtCol('ITEM_NAME', 'Item Name'),
  dateCol('BILL_DATE', 'Bill Date'),
  txtCol('BILL_NO', 'Bill No'),
  txtCol('CODE', 'Party'),
  txtCol('NAME', 'Name'),
  txtCol('STATUS', 'St'),
  numCol('QNTY', 'Qty'),
  numCol('WEIGHT', 'Weight'),
  numCol('RATE', 'Rate'),
  numCol('AMOUNT', 'Amount'),
  numCol('BROK_PER', 'Brok %'),
  numCol('BROKERAGE', 'Brokerage'),
  numCol('DANE_AMT', 'Dane'),
  numCol('P_AMT', 'P Amt'),
];

/** @type {Record<string, object>} */
export const OTHER_REPORT_DEFS = {
  'labour-report': {
    filters: ['sdt', 'edt'],
    labourReportLayout: true,
    labourDateDrill: true,
    compactTable: true,
    pdfLandscape: true,
    grandTotalLabelKey: 'VR_DATE',
    grandTotalKeys: ['LRBAGS','LRKATA','LRHKAT','CRBAGS','CRKATA','CRHKAT','LSBAGS','LSKATA','LSHKAT','LRBAMT','LRKAMT','LRHAMT','CRBAMT','CRKAMT','CRHAMT','LSBAMT','LSKAMT','LSHAMT','TOT_AMT'],
    drillDisplayColumns: [
      txtCol('SECTION', 'Section'),
      txtCol('E_TYPE', 'Type'),
      txtCol('L_C', 'L/C'),
      txtCol('STATUS', 'St'),
      numCol('R_QNTY', 'R Qty'),
      numCol('S_QNTY', 'S Qty'),
      numCol('LAB_AMT', 'Lab Amt'),
      txtCol('B_NO', 'B.No'),
      numCol('ITEM_CODE', 'Item'),
      txtCol('ITEM_NAME', 'Item Name'),
      txtCol('LOT', 'Lot'),
      txtCol('SUP_CODE', 'Sup'),
      txtCol('SUP_NAME', 'Supplier'),
      txtCol('EXP_CAT', 'Exp'),
      txtCol('VR_NO', 'Vr No'),
      txtCol('VR_TYPE', 'Vr Type'),
    ],
    displayColumns: [
      dateCol('VR_DATE', 'Date'),
      numCol('LRBAGS', 'LR Bags'), numCol('LRBAMT', 'LR Bags Amt'),
      numCol('LRKATA', 'LR Katta'), numCol('LRKAMT', 'LR Katta Amt'),
      numCol('LRHKAT', 'LR HKatta'), numCol('LRHAMT', 'LR HKatta Amt'),
      numCol('CRBAGS', 'CR Bags'), numCol('CRBAMT', 'CR Bags Amt'),
      numCol('CRKATA', 'CR Katta'), numCol('CRKAMT', 'CR Katta Amt'),
      numCol('CRHKAT', 'CR HKatta'), numCol('CRHAMT', 'CR HKatta Amt'),
      numCol('LSBAGS', 'LS Bags'), numCol('LSBAMT', 'LS Bags Amt'),
      numCol('LSKATA', 'LS Katta'), numCol('LSKAMT', 'LS Katta Amt'),
      numCol('LSHKAT', 'LS HKatta'), numCol('LSHAMT', 'LS HKatta Amt'),
      numCol('TOT_AMT', 'Tot.Amt.'),
    ],
  },
  'brokerage-date-wise': {
    filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'scode', 'mcode', 'icode', 'msp', 'mds'],
    compactEntry: true,
    compactTable: true,
    saleBillDrill: true,
    brokerSummaryDrill: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['BK_CODE'],
    partyGroupHideKeys: ['BK_CODE', 'BNAME'],
    partyGroupHeaderMinimal: true,
    partyGroupSubtotalLabelKey: 'NAME',
    partyGroupSubtotalLabel: 'TOTAL',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'NAME', 'ITEM_NAME'],
    grandTotalKeys: ['BAGS', 'KATTA', 'HKATTA', 'WEIGHT', 'AMOUNT', 'BROKERAGE', 'DANE_AMT', 'P_AMT', 'LINE_TOT', 'FREIGHT'],
    grandTotalLabelKey: 'NAME',
    summaryGrandTotalLabelKey: 'BNAME',
    filterOverrides: BROKER_REPORT_ENTRY_OVERRIDES,
    summaryDisplayColumns: [
      txtCol('BK_CODE', 'Broker'),
      txtCol('BNAME', 'Name'),
      numCol('BAGS', 'Bags'),
      numCol('KATTA', 'Katta'),
      numCol('HKATTA', 'H.Katta'),
      numCol('WEIGHT', 'Weight'),
      numCol('AMOUNT', 'Amount'),
      numCol('BROKERAGE', 'Brokerage'),
      numCol('DANE_AMT', 'Dane'),
      numCol('P_AMT', 'P.Amt.'),
      numCol('LINE_TOT', 'Total'),
      numCol('FREIGHT', 'Freight'),
    ],
    displayColumns: [
      dateCol('BILL_DATE', 'Date'),
      txtCol('BILL_NO', 'B.No.'),
      txtCol('NAME', 'Party Name'),
      txtCol('ITEM_NAME', 'Item Name'),
      numCol('BAGS', 'Bags'),
      numCol('KATTA', 'Katta'),
      numCol('HKATTA', 'H.Katta'),
      numCol('RATE', 'Rate'),
      numCol('WEIGHT', 'Weight'),
      numCol('AMOUNT', 'Amount'),
      numCol('BROK_PER', 'Brk.Rate'),
      numCol('BROKERAGE', 'Brokerage'),
      numCol('DANE_AMT', 'Dane'),
      numCol('P_AMT', 'P.Amt.'),
      numCol('LINE_TOT', 'Total'),
      numCol('FREIGHT', 'Freight'),
    ],
  },
  'brokerage-item-wise': {
    filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'scode', 'mcode', 'icode', 'msp', 'mds'],
    compactEntry: true,
    compactTable: true,
    saleBillDrill: true,
    brokerItemGroups: true,
    brokerGroupKeys: ['BK_CODE'],
    itemGroupKeys: ['ITEM_CODE', 'ITEM_NAME'],
    brokerGroupHideKeys: ['BK_CODE', 'BNAME'],
    itemGroupHideKeys: ['ITEM_CODE', 'ITEM_NAME'],
    partyGroupHeaderMinimal: true,
    brokerSubtotalLabelKey: 'NAME',
    itemSubtotalLabelKey: 'NAME',
    brokerSubtotalLabel: 'BROKER TOTAL',
    itemSubtotalLabel: 'ITEM TOTAL',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'NAME'],
    grandTotalKeys: BROKER_REPORT_GRAND_KEYS,
    grandTotalLabelKey: 'NAME',
    filterOverrides: BROKER_REPORT_ENTRY_OVERRIDES,
    summaryDisplayColumns: BROKER_ITEM_SUMMARY_COLS,
    summaryGrandTotalLabelKey: 'ITEM_NAME',
    summaryBrokerSubtotalLabelKey: 'ITEM_NAME',
    itemSummaryMobileCardHeadKeys: ['ITEM_CODE', 'ITEM_NAME'],
    brokerItemSummaryDrill: true,
    displayColumns: BROKER_REPORT_DETAIL_COLS,
  },
  'brokerage-item-cat-wise': {
    filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'scode', 'mcode', 'icode', 'icat', 'mlc', 'mds'],
    compactEntry: true,
    compactTable: true,
    saleBillDrill: true,
    brokerItemGroups: true,
    brokerGroupKeys: ['BK_CODE'],
    itemGroupKeys: ['ITEM_CAT'],
    itemGroupLabelFn: 'itemCat',
    brokerGroupHideKeys: ['BK_CODE', 'BNAME'],
    itemGroupHideKeys: ['ITEM_CAT'],
    partyGroupHeaderMinimal: true,
    brokerSubtotalLabelKey: 'NAME',
    itemSubtotalLabelKey: 'NAME',
    brokerSubtotalLabel: 'BROKER TOTAL',
    itemSubtotalLabel: 'ITEM CAT TOTAL',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'NAME'],
    grandTotalKeys: BROKER_REPORT_GRAND_KEYS,
    grandTotalLabelKey: 'NAME',
    filterOverrides: BROKER_ITEM_CAT_ENTRY_OVERRIDES,
    summaryDisplayColumns: BROKER_ITEM_CAT_SUMMARY_COLS,
    summaryGrandTotalLabelKey: 'ITEM_CAT',
    summaryBrokerSubtotalLabelKey: 'ITEM_CAT',
    itemSummaryMobileCardHeadKeys: ['ITEM_CAT'],
    brokerItemSummaryDrill: true,
    brokerItemSummaryDrillMode: 'itemCat',
    displayColumns: BROKER_ITEM_CAT_DETAIL_COLS,
  },
  'broker-summary': {
    filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'scode', 'mcode', 'icode'],
    compactEntry: true,
    compactTable: true,
    saleBillDrill: true,
    brokerSummaryDrill: true,
    brokerSummaryOnly: true,
    filterOverrides: BROKER_REPORT_ENTRY_OVERRIDES,
    summaryDisplayColumns: BROKER_SUMMARY_LIST_COLS,
    drillDisplayColumns: BROKER_SUMMARY_DRILL_COLS,
    displayColumns: BROKER_SUMMARY_DRILL_COLS,
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'NAME', 'ITEM_NAME'],
    grandTotalKeys: BROKER_REPORT_GRAND_KEYS,
    grandTotalLabelKey: 'BNAME',
    summaryGrandTotalLabelKey: 'BNAME',
  },
  'insurance-report': {
    filters: ['sdt', 'edt', 'mlc', 'rpttype', 'mcn'],
    compactTable: true,
    filterOverrides: INSURANCE_FILTER_OVERRIDES,
    detailDisplayColumns: INSURANCE_DETAIL_COLS,
    summaryDisplayColumns: INSURANCE_SUMMARY_COLS,
    grandTotalKeys: ['BAGS', 'WEIGHT', 'INV_VALUE', 'AMOUNT', 'INV_PLUS_10'],
    grandTotalLabelKey: 'FROM_TO',
    summaryGrandTotalLabelKey: 'BILL_DATE',
    displayColumns: INSURANCE_DETAIL_COLS,
  },
  'trading-exp': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    voucherLedgerDrill: true,
    partyGroupWithTotals: true,
    partyGroupKeys: ['CODE'],
    partyGroupHideKeys: ['CODE', 'NAME'],
    partyGroupHeaderMinimal: true,
    partyGroupSubtotalLabelKey: 'DETAIL',
    partyGroupSubtotalLabel: 'ACCOUNT TOTAL',
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'DETAIL',
    mobileCardHeadKeys: ['VR_DATE', 'VR_NO', 'VR_TYPE'],
    voucherDrillMobileCardHeadKeys: ['CODE', 'NAME'],
    drillDisplayColumns: TRADING_EXP_VOUCHER_DRILL_COLS,
    filterOverrides: {
      mcode: {
        label: 'Account Code',
        hint: 'Optional — tap ? to pick from account master; leave blank for all trading expense accounts.',
        pickList: 'masterAccount',
        manualCode: true,
      },
    },
    displayColumns: [
      txtCol('VR_TYPE', 'Type'),
      dateCol('VR_DATE', 'Date'),
      txtCol('VR_NO', 'No'),
      txtCol('DETAIL', 'Detail'),
      numCol('DR_AMT', 'Debit'),
      numCol('CR_AMT', 'Credit'),
    ],
  },
  'broker-ledger': {
    filters: ['sdt', 'edt', 'mcode'],
    compactEntry: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'DETAIL',
    monthSummaryCards: true,
    mobileCardHeadKeys: ['VR_DATE', 'VR_NO', 'VR_TYPE'],
    filterOverrides: {
      mcode: {
        label: 'Broker Code',
        required: true,
        manualCode: true,
        pickList: 'masterBroker',
        hint: 'Type broker code or tap ? / F1 to search by name.',
      },
    },
    displayColumns: [
      dateCol('VR_DATE', 'Date'),
      txtCol('VR_NO', 'No'),
      txtCol('VR_TYPE', 'Type'),
      txtCol('DETAIL', 'Detail'),
      numCol('DR_AMT', 'Debit'),
      numCol('CR_AMT', 'Credit'),
      txtCol('NAME', 'Name'),
    ],
  },
  'broker-trial': {
    filters: ['sdt', 'edt'],
    compactTable: true,
    brokerLedgerDrill: true,
    grandTotalKeys: ['OPBAL', 'DR_AMT', 'CR_AMT', 'CLBAL'],
    drillDisplayColumns: BROKER_LEDGER_DRILL_COLS,
    mobileCardHeadKeys: ['VR_DATE', 'VR_NO', 'VR_TYPE'],
    displayColumns: [
      txtCol('CODE', 'Code'),
      txtCol('NAME', 'Name'),
      txtCol('CITY', 'City'),
      numCol('OPBAL', 'Opening'),
      numCol('DR_AMT', 'Debit'),
      numCol('CR_AMT', 'Credit'),
      numCol('CLBAL', 'Closing'),
    ],
  },
  'paploo-report': {
    filters: ['sdt', 'edt', 'mcode'],
    compactTable: true,
    displayColumns: [dateCol('BILL_DATE', 'Date'), txtCol('BILL_NO', 'Bill'), numCol('QNTY', 'Qty'), numCol('WEIGHT', 'Weight'), numCol('RATE', 'Rate'), numCol('AMOUNT', 'Amount'), numCol('P_AMT1', 'P Amt1'), numCol('P_AMT2', 'P Amt2'), numCol('P_AMT3', 'P Amt3'), numCol('P_AMT5', 'P Amt5')],
  },
  'brokerage-purchase': { filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'scode', 'mcode', 'icode', 'icat'], compactTable: true, displayColumns: BROKER_ITEM_COLS },
  'voucher-adv-payment-revd': {
    filters: ['sdt', 'edt'],
    compactTable: true,
    displayColumns: [dateCol('VR_DATE', 'Vr Date'), txtCol('VR_NO', 'No'), txtCol('VR_TYPE', 'Type'), txtCol('CODE', 'Code'), txtCol('NAME', 'Name'), txtCol('DETAIL', 'Detail'), numCol('DR_AMT', 'Debit'), numCol('CR_AMT', 'Credit'), dateCol('BILL_DATE', 'Bill Date')],
  },
  'chant-format-1': {
    filters: ['sdt', 'edt', 'scode', 'icode', 'btype', 'godCode', 'mSupCode'],
    compactEntry: true,
    compactTable: true,
    chantGroups: 'lotRate',
    grandTotalKeys: ['QNTY', 'WEIGHT', 'AMOUNT'],
    grandTotalLabelKey: 'BILL_NO',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'LOT'],
    filterOverrides: CHANT_ENTRY_OVERRIDES,
    displayColumns: CHANT_FORMAT_1_COLS,
  },
  'chant-format-2': {
    filters: ['sdt', 'edt', 'scode', 'icode', 'btype', 'godCode', 'mSupCode'],
    compactEntry: true,
    compactTable: true,
    chantGroups: 'item',
    grandTotalKeys: ['QNTY', 'WEIGHT', 'AMOUNT'],
    grandTotalLabelKey: 'BILL_NO',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'ITEM_CODE'],
    filterOverrides: CHANT_ENTRY_OVERRIDES,
    displayColumns: CHANT_FORMAT_2_COLS,
  },
  'chant-format-3': {
    filters: ['sdt', 'edt', 'scode', 'icode', 'btype', 'godCode', 'mSupCode'],
    compactEntry: true,
    compactTable: true,
    chantGroups: 'supplier',
    grandTotalKeys: ['QNTY', 'WEIGHT', 'AMOUNT'],
    grandTotalLabelKey: 'BILL_NO',
    mobileCardHeadKeys: ['BILL_DATE', 'BILL_NO', 'ITEM_CODE'],
    filterOverrides: CHANT_ENTRY_OVERRIDES,
    displayColumns: CHANT_FORMAT_3_COLS,
  },
  'chant-summary': {
    filters: ['sdt', 'edt', 'scode', 'icode', 'btype', 'godCode', 'mSupCode'],
    compactEntry: true,
    compactTable: true,
    chantGroups: 'summary',
    grandTotalKeys: ['QNTY', 'WEIGHT', 'AMOUNT'],
    grandTotalLabelKey: 'ITEM_NAME',
    mobileCardHeadKeys: ['NAME', 'ITEM_NAME', 'LOT'],
    filterOverrides: CHANT_ENTRY_OVERRIDES,
    displayColumns: CHANT_SUMMARY_COLS,
  },
  'broker-wise-scheme': { filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'godCode'], compactTable: true, displayColumns: [txtCol('BK_CODE', 'Broker'), txtCol('BNAME', 'Name'), txtCol('ITEM_CODE', 'Item'), txtCol('ITEM_NAME', 'Item'), numCol('BAGS', 'Bags'), numCol('KATTA', 'Kata'), numCol('WEIGHT', 'Wgt'), numCol('AMOUNT', 'Amt'), numCol('BROKERAGE', 'Brok'), numCol('DANE_AMT', 'Dane')] },
  'broker-dalali-less-freight': { filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'msp'], compactTable: true, displayColumns: [txtCol('BK_CODE', 'Broker'), dateCol('BILL_DATE', 'Date'), txtCol('BILL_NO', 'Bill'), numCol('AMOUNT', 'Amount'), numCol('FREIGHT', 'Freight'), numCol('BROKERAGE', 'Brokerage')] },
  'freight-party-ledger': {
    filters: ['sdt', 'edt', 'mcode'],
    filterOverrides: { mcode: { label: 'Freight Party Code', required: true } },
    compactTable: true,
    displayColumns: [dateCol('BILL_DATE', 'Bill Date'), txtCol('BILL_NO', 'Bill'), dateCol('VR_DATE', 'Vr Date'), numCol('DR_AMT', 'Debit'), numCol('CR_AMT', 'Credit'), numCol('BAL', 'Balance'), txtCol('DETAIL', 'Detail')],
  },
  'indent-party-ledger': {
    filters: ['sdt', 'edt', 'mcode'],
    filterOverrides: { mcode: { label: 'Indent Party Code', required: true } },
    compactTable: true,
    displayColumns: [dateCol('BILL_DATE', 'Bill Date'), txtCol('BILL_NO', 'Bill'), dateCol('VR_DATE', 'Vr Date'), numCol('DR_AMT', 'Debit'), numCol('CR_AMT', 'Credit'), numCol('BAL', 'Balance'), txtCol('DETAIL', 'Detail')],
  },
  'purchase-outstanding-month': {
    filters: ['sdt', 'edt'],
    filterOverrides: { edt: { label: 'As On Date' }, sdt: { label: 'From (optional)' } },
    compactTable: true,
    monthOutstandingLayout: true,
    monthOutstandingDrill: true,
    monthSummaryCards: true,
    mobileCardHeadKeys: ['CMTH'],
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'CMTH',
    drillDisplayColumns: MONTH_OUTSTANDING_DRILL_COLS_PURCHASE,
    displayColumns: [
      txtCol('CMTH', 'Month'),
      numCol('OPBAL', 'Opening'),
      numCol('CR_AMT', 'Purchase'),
      numCol('DR_AMT', 'Payment'),
      numCol('CLBAL', 'Closing'),
    ],
  },
  'sale-outstanding-month': {
    filters: ['sdt', 'edt'],
    filterOverrides: { edt: { label: 'As On Date' }, sdt: { label: 'From (optional)' } },
    compactTable: true,
    monthOutstandingLayout: true,
    monthOutstandingDrill: true,
    monthSummaryCards: true,
    mobileCardHeadKeys: ['CMTH'],
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'CMTH',
    drillDisplayColumns: MONTH_OUTSTANDING_DRILL_COLS_SALE,
    displayColumns: [
      txtCol('CMTH', 'Month'),
      numCol('OPBAL', 'Opening'),
      numCol('DR_AMT', 'Sale'),
      numCol('CR_AMT', 'Receipt'),
      numCol('CLBAL', 'Closing'),
    ],
  },
  'dalali-excel': {
    filters: ['sdt', 'edt', 'sbCode', 'ebCode', 'scode', 'mcode', 'icode'],
    compactEntry: true,
    entryFilterHints: true,
    compactTable: true,
    grandTotalKeys: ['TDG_BROK', 'CONSG_BROK', 'TDG_DANE', 'CONSG_DANE'],
    grandTotalLabelKey: 'BILL_NO',
    filterOverrides: DALALI_EXCEL_ENTRY_OVERRIDES,
    displayColumns: [
      dateCol('BILL_DATE', 'Date'),
      txtCol('BILL_NO', 'Bill'),
      txtCol('CUSTOMER', 'Customer'),
      txtCol('SUP_NAME', 'Supplier'),
      txtCol('ITEM_NAME', 'Item'),
      numCol('TDG_BROK', 'Tdg Brok'),
      numCol('CONSG_BROK', 'Consg Brok'),
      numCol('TDG_DANE', 'Tdg Dane'),
      numCol('CONSG_DANE', 'Consg Dane'),
      txtCol('BROKER_NAME', 'Broker'),
    ],
  },
  'combined-sale-purchase': {
    filters: ['sdt', 'edt'],
    compactTable: true,
    displayColumns: [txtCol('SRC', 'Source'), dateCol('TRN_DATE', 'Date'), txtCol('TRN_NO', 'No'), txtCol('CODE', 'Party'), txtCol('NAME', 'Name'), txtCol('ITEM_NAME', 'Item'), numCol('QNTY', 'Qty'), numCol('WEIGHT', 'Wgt'), numCol('AMOUNT', 'Amount')],
  },
};

export const OTHER_REPORT_FILTER_LABELS = {
  sdt: 'Starting Date',
  edt: 'Ending Date',
  csdt: 'Credit From Date',
  cedt: 'Credit To Date',
  scode: 'Supplier Code',
  mcode: 'Party / Account Code',
  icode: 'Item Code',
  sbCode: 'Broker From',
  ebCode: 'Broker To',
  msp: 'Sale / Purchase',
  icat: 'Item Category',
  mlc: 'L/C Filter (L/C/blank)',
  mds: 'Detail (D) / Summary (S)',
  rpttype: 'Type (S=sale/C=CN)',
  mcn: 'Detail (D) / Summary (S)',
  btype: 'Bill Type',
  godCode: 'Godown Code',
  mSupCode: 'Main Supplier Code',
};

export const OTHER_REPORT_FILTER_HINTS = {
  sbCode: 'Broker code range start (default B00000).',
  ebCode: 'Broker code range end (default B99999).',
  msp: 'S = Sale bills, P = Purchase records.',
  mds: 'D = detail lines, S = summary by bill.',
  mlc: 'L = local, C = consignment, blank = all.',
  mcn: 'D = invoice-wise detail (insrpt), S = summarise by bill date.',
};

export function getOtherReportDef(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return OTHER_REPORT_DEFS[id] || { filters: ['sdt', 'edt'] };
}

export function resolveOtherReportFilterMeta(reportId, filterKey) {
  const def = getOtherReportDef(reportId);
  const override = def?.filterOverrides?.[filterKey] || {};
  return {
    label: override.label || OTHER_REPORT_FILTER_LABELS[filterKey] || humanizeColumnKey(filterKey),
    hint: override.hint !== undefined ? override.hint : OTHER_REPORT_FILTER_HINTS[filterKey],
    pickList: override.pickList || (filterKey === 'msp' ? [{ value: 'S', label: 'Sale' }, { value: 'P', label: 'Purchase' }] : filterKey === 'mds' ? [{ value: 'D', label: 'Detail' }, { value: 'S', label: 'Summary' }] : null),
    manualCode: override.manualCode === true,
    defaultValue: override.defaultValue != null ? String(override.defaultValue).trim() : (filterKey === 'sbCode' ? 'B00000' : filterKey === 'ebCode' ? 'B99999' : filterKey === 'msp' ? 'S' : filterKey === 'mds' ? 'D' : ''),
    required: override.required === true,
  };
}

export function resolveOtherReportDisplayColumns(reportId, apiColumns, rows) {
  const def = getOtherReportDef(reportId);
  if (def.displayColumns?.length) return def.displayColumns;
  if (apiColumns?.length) return apiColumns;
  const sample = rows?.[0];
  if (!sample) return [];
  return Object.keys(sample)
    .filter((k) => !k.startsWith('_'))
    .map((key) => ({
      key,
      label: humanizeColumnKey(key),
      type: /amt|amount|bal|weight|wgt|qty|qnty|rate|tot|dr|cr|brok|dane|bags|kata/i.test(key) ? 'num' : /date/i.test(key) ? 'date' : 'text',
    }));
}
