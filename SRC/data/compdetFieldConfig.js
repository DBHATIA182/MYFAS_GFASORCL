/** VFP DO FORM compdet — COMPDET + COMPANY.COMP_NAME update fields. */

export const COMPDET_LIMITED_LOCKED_KEYS = new Set(['COMP_NAME', 'COMP_S_DT', 'COMP_E_DT']);

export const COMPDET_TABS = [
  { id: 'company', label: 'Company' },
  { id: 'bank', label: 'Bank & IDs' },
  { id: 'integrations', label: 'Email / SMS / APIs' },
];

/** @type {Array<{ key: string, label: string, tab: string, type?: string, maxLen?: number, readOnly?: boolean, hint?: string }>} */
export const COMPDET_FIELD_SPECS = [
  { key: 'COMP_CODE', label: 'Comp Code', tab: 'company', readOnly: true },
  { key: 'COMP_YEAR', label: 'Financial Year', tab: 'company', readOnly: true },
  { key: 'COMP_UID', label: 'Schema (comp_uid)', tab: 'company', readOnly: true },
  { key: 'COMP_NAME', label: 'Company Name', tab: 'company', maxLen: 60 },
  { key: 'COMP_ADD1', label: 'Address Line 1', tab: 'company', maxLen: 50 },
  { key: 'COMP_ADD2', label: 'Address Line 2', tab: 'company', maxLen: 50 },
  { key: 'COMP_TEL1', label: 'Tel. 1', tab: 'company', maxLen: 30 },
  { key: 'COMP_TEL2', label: 'Tel. 2 / Fax', tab: 'company', maxLen: 30 },
  { key: 'COMP_TEL3', label: 'Tel. 3', tab: 'company', maxLen: 30 },
  { key: 'EMAIL', label: 'Email', tab: 'company', maxLen: 80 },
  { key: 'WEBSITE', label: 'Website', tab: 'company', maxLen: 80 },
  { key: 'COMP_TIN', label: 'Tin / IEC No.', tab: 'company', maxLen: 20 },
  { key: 'COMP_PAN', label: 'PAN', tab: 'company', maxLen: 12 },
  { key: 'COMP_TDSNO', label: 'TAN', tab: 'company', maxLen: 20 },
  { key: 'COMP_PROP', label: 'Prop / Director / Partner', tab: 'company', maxLen: 40 },
  { key: 'COMP_P_D', label: 'Administrator Password', tab: 'company', type: 'password', maxLen: 30 },
  { key: 'COMP_S_DT', label: 'F.Year Start Date', tab: 'company', type: 'date' },
  { key: 'COMP_E_DT', label: 'F.Year End Date', tab: 'company', type: 'date' },
  { key: 'GST_NO', label: 'GST No.', tab: 'company', maxLen: 20 },
  { key: 'STATE', label: 'State', tab: 'company', maxLen: 30 },
  { key: 'STATE_CODE', label: 'State Code', tab: 'company', maxLen: 2 },
  { key: 'PIN_CODE', label: 'PIN Code', tab: 'company', maxLen: 10 },
  { key: 'FSSAI_NO', label: 'FSSAI No.', tab: 'company', maxLen: 20 },
  { key: 'LLPIN', label: 'LLPIN', tab: 'company', maxLen: 20 },
  { key: 'HIDE_YEAR', label: 'Hide Year (Y/N)', tab: 'company', type: 'yn' },
  { key: 'BACKUP_YN', label: 'Backup (Y/N)', tab: 'company', type: 'yn' },
  { key: 'SALE_BILL_INIT', label: 'Sale Bill Initial', tab: 'company', maxLen: 10 },
  { key: 'BTYPE_YN', label: 'B.Type Print (Y/N)', tab: 'company', type: 'yn' },
  { key: 'ZERO_BEFORE_PRINTING', label: 'Zero Before Printing (Y/N)', tab: 'company', type: 'yn' },

  { key: 'BANK_AC_NO', label: 'Bank A/c No.', tab: 'bank', maxLen: 30 },
  { key: 'BANK_AC_NO1', label: 'Bank A/c No. 2', tab: 'bank', maxLen: 30 },
  { key: 'GROUP_ID', label: 'Group Id', tab: 'bank', maxLen: 20 },
  { key: 'LEG_CODE', label: 'Ledger Code', tab: 'bank', maxLen: 10 },
  { key: 'CIN_NO', label: 'CIN No.', tab: 'bank', maxLen: 25 },
  { key: 'UDYAM_REG_NO', label: 'Udyam Reg. No.', tab: 'bank', maxLen: 25 },
  { key: 'UPI_ID', label: 'UPI Id', tab: 'bank', maxLen: 50 },
  { key: 'CUSTOMER_ID_IBL', label: 'IBL Customer Id', tab: 'bank', maxLen: 30 },
  { key: 'IBL_BANK_AC_NO', label: 'IBL Bank A/c No.', tab: 'bank', maxLen: 30 },
  { key: 'IBL_AUTH_PERSON', label: 'IBL Auth. Person', tab: 'bank', maxLen: 40 },
  { key: 'IBL_AUTH_PERSON_TEL', label: 'IBL Auth. Person Mob.', tab: 'bank', maxLen: 20 },
  { key: 'IBL_MAKER_ID', label: 'IBL Maker Id', tab: 'bank', maxLen: 20 },

  { key: 'SALE_EMAIL', label: 'Sale Bill Email', tab: 'integrations', maxLen: 80 },
  { key: 'SALE_EMAIL_PW', label: 'Sale Bill Email PW', tab: 'integrations', type: 'password', maxLen: 40 },
  { key: 'SALE_EMAIL_NOREPLY', label: 'Sale Bill Email NoReply', tab: 'integrations', maxLen: 80 },
  { key: 'EMAIL_PORT', label: 'Email Port', tab: 'integrations', maxLen: 10 },
  { key: 'EMAIL_L_O', label: 'Email Outlook/Others (L/O)', tab: 'integrations', maxLen: 1, hint: 'L or O' },
  { key: 'SMS_LINK', label: 'SMS Link', tab: 'integrations', maxLen: 120 },
  { key: 'SMS_SENDER_ID', label: 'SMS Sender Id', tab: 'integrations', maxLen: 20 },
  { key: 'SMS_MSG_TYPE', label: 'SMS Message Type', tab: 'integrations', maxLen: 10 },
  { key: 'EINV_FILE_NAME', label: 'E-Inv File Name', tab: 'integrations', maxLen: 40 },
  { key: 'FAS_INVOYZ_API_KEY', label: 'FasInvoyz API Key', tab: 'integrations', type: 'password', maxLen: 80 },
  { key: 'FAS_INVOYZ_MID', label: 'FasInvoyz MID', tab: 'integrations', maxLen: 40 },
  { key: 'FAS_INVOYZ_SALT', label: 'FasInvoyz Salt', tab: 'integrations', type: 'password', maxLen: 40 },
  { key: 'FAS_INVOYZ_OUR_BANK_CODE', label: 'FasInvoyz Our Bank Code', tab: 'integrations', maxLen: 20 },
  { key: 'FAS_INVOYZ_BANK_CHGS_CODE', label: 'FasInvoyz Bank Chgs. Code', tab: 'integrations', maxLen: 20 },
  { key: 'FAS_INVOYZ_DR_CODE', label: 'FasInvoyz Dr. Code', tab: 'integrations', maxLen: 20 },
  { key: 'DOVESOFT_URL', label: 'WhatsApp / Dovesoft URL', tab: 'integrations', maxLen: 120 },
  { key: 'DOVESOFT_USER', label: 'Dovesoft User', tab: 'integrations', maxLen: 40 },
  { key: 'DOVESOFT_KEY', label: 'Dovesoft Key', tab: 'integrations', type: 'password', maxLen: 80 },
  { key: 'DOVESOFT_SENDER_ID', label: 'Dovesoft Sender Id', tab: 'integrations', maxLen: 20 },
  { key: 'DOVESOFT_ACCUSAGE', label: 'Dovesoft Acc Usage', tab: 'integrations', maxLen: 20 },
];

export function compdetFieldsForTab(tabId) {
  return COMPDET_FIELD_SPECS.filter((f) => f.tab === tabId);
}
