/** Per-type settings for Cash / Bank / Journal voucher entry (VFP voucher.scx / voucher_JOURNAL). */

export const CASH_VOUCHER_ENTRY_SLIDE = 93;
export const BANK_VOUCHER_ENTRY_SLIDE = 94;
export const JOURNAL_VOUCHER_ENTRY_SLIDE = 95;

/** @typedef {'one-sided' | 'balanced'} VoucherBalanceMode */

/**
 * @typedef {object} VoucherEntryTypeConfig
 * @property {string} vrType
 * @property {string} entryId
 * @property {string} title
 * @property {string} cbLabel
 * @property {string} cbNameLabel
 * @property {string} totLabel
 * @property {number|null} scheduleFilter — MASTER schedule × 100 (910 = 9.10, 920 = 9.20)
 * @property {string|null} defaultEndpoint — `/api/voucher-entry/{endpoint}`
 * @property {boolean} requiresCbAccount
 * @property {boolean} hideCbHeader
 * @property {VoucherBalanceMode} balanceMode
 * @property {boolean} showJvLinks — CD / Int linked JV nos. on header
 * @property {boolean} showDcCodeCol — DCCode column in grid (journal)
 * @property {number} hubSlide
 * @property {string} helpReportId
 * @property {string} voucherKindLabel — e.g. "cash voucher"
 * @property {string} checklistActionId — transaction module id for type checklist (slide 14)
 */

/** @type {Record<string, VoucherEntryTypeConfig>} */
export const VOUCHER_ENTRY_CONFIGS = {
  CV: {
    vrType: 'CV',
    entryId: 'cash-voucher-entry',
    title: 'Cash Voucher',
    cbLabel: 'Cash A/c',
    cbNameLabel: 'Cash name',
    totLabel: 'Tot.Cash',
    scheduleFilter: 910,
    defaultEndpoint: 'default-cash',
    requiresCbAccount: true,
    hideCbHeader: false,
    balanceMode: 'one-sided',
    showJvLinks: true,
    hubSlide: CASH_VOUCHER_ENTRY_SLIDE,
    helpReportId: 'cash-voucher-entry',
    voucherKindLabel: 'cash voucher',
    checklistActionId: 'cash-voucher-checklist',
  },
  BV: {
    vrType: 'BV',
    entryId: 'bank-voucher-entry',
    title: 'Bank Voucher',
    cbLabel: 'Bank A/c',
    cbNameLabel: 'Bank name',
    totLabel: 'Tot.Bank',
    scheduleFilter: 920,
    defaultEndpoint: 'default-bank',
    requiresCbAccount: true,
    hideCbHeader: false,
    balanceMode: 'one-sided',
    showJvLinks: true,
    hubSlide: BANK_VOUCHER_ENTRY_SLIDE,
    helpReportId: 'bank-voucher-entry',
    voucherKindLabel: 'bank voucher',
    checklistActionId: 'bank-voucher-checklist',
  },
  JV: {
    vrType: 'JV',
    entryId: 'journal-voucher-entry',
    title: 'Journal Voucher',
    cbLabel: '',
    cbNameLabel: '',
    totLabel: '',
    scheduleFilter: null,
    defaultEndpoint: null,
    requiresCbAccount: false,
    hideCbHeader: true,
    balanceMode: 'balanced',
    showJvLinks: false,
    showDcCodeCol: true,
    hubSlide: JOURNAL_VOUCHER_ENTRY_SLIDE,
    helpReportId: 'journal-voucher-entry',
    voucherKindLabel: 'journal voucher',
    checklistActionId: 'journal-voucher-checklist',
  },
};

/** @param {string} [vrType] */
export function getVoucherEntryConfig(vrType = 'CV') {
  const key = String(vrType ?? 'CV').trim().toUpperCase();
  return VOUCHER_ENTRY_CONFIGS[key] || VOUCHER_ENTRY_CONFIGS.CV;
}

/** @param {string} entryId */
export function getVoucherEntryConfigByEntryId(entryId) {
  const id = String(entryId ?? '').trim().toLowerCase();
  const found = Object.values(VOUCHER_ENTRY_CONFIGS).find((c) => c.entryId === id);
  return found || VOUCHER_ENTRY_CONFIGS.CV;
}

/** @param {string} entryId */
export function voucherHubSlideForEntryId(entryId) {
  return getVoucherEntryConfigByEntryId(entryId).hubSlide;
}
