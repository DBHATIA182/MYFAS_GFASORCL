/** VFP DO FORM gst_profile — GST_PROFILE hub table (per COMP_CODE). */

export const GST_PROFILE_TABS = [
  { id: 'company', label: 'Company & GST' },
  { id: 'einvoice', label: 'E-Invoice API' },
  { id: 'eway', label: 'E-Way & Print Links' },
];

/** @type {Array<{ key: string, label: string, tab: string, type?: string, maxLen?: number, readOnly?: boolean, hint?: string }>} */
export const GST_PROFILE_FIELD_SPECS = [
  { key: 'COMP_CODE', label: 'Comp Code', tab: 'company', readOnly: true },
  { key: 'GST_NO', label: 'GST No.', tab: 'company', maxLen: 20 },
  { key: 'COMP_NAME', label: 'Company Name', tab: 'company', maxLen: 80 },
  { key: 'TRADE_NAME', label: 'Trade Name', tab: 'company', maxLen: 80 },
  { key: 'POS_STATE_CODE', label: 'POS State Code', tab: 'company', maxLen: 2 },
  { key: 'STATE_CODE', label: 'State Code', tab: 'company', maxLen: 2 },
  { key: 'ADD1', label: 'Address Line 1', tab: 'company', maxLen: 80 },
  { key: 'ADD2', label: 'Address Line 2', tab: 'company', maxLen: 80 },
  { key: 'CITY', label: 'City', tab: 'company', maxLen: 40 },
  { key: 'PIN_CODE', label: 'PIN Code', tab: 'company', maxLen: 10 },
  { key: 'PHONE', label: 'Phone', tab: 'company', maxLen: 30 },
  { key: 'EMAIL', label: 'Email', tab: 'company', maxLen: 80 },
  { key: 'RENEWAL_DATE', label: 'Renewal Date', tab: 'company', type: 'date' },

  { key: 'API_LINK', label: 'API Link', tab: 'einvoice', maxLen: 200 },
  { key: 'API_LINK_CANC', label: 'API Link Cancel', tab: 'einvoice', maxLen: 200 },
  { key: 'USER_NAME', label: 'User Name', tab: 'einvoice', maxLen: 40 },
  { key: 'PASSWORD', label: 'Password', tab: 'einvoice', type: 'password', maxLen: 40 },
  { key: 'CUSTOMER_ID', label: 'Customer Id', tab: 'einvoice', maxLen: 40 },
  { key: 'APPID', label: 'App Id', tab: 'einvoice', maxLen: 40 },
  { key: 'APISECRET', label: 'API Secret', tab: 'einvoice', type: 'password', maxLen: 80 },

  { key: 'API_LINK_EWAY', label: 'API Link E-Way', tab: 'eway', maxLen: 200 },
  { key: 'API_LINK_EWAY_CANC', label: 'API Link E-Way Cancel', tab: 'eway', maxLen: 200 },
  { key: 'USER_NAME_EWAY', label: 'E-Way User Name', tab: 'eway', maxLen: 40 },
  { key: 'PASSWORD_EWAY', label: 'E-Way Password', tab: 'eway', type: 'password', maxLen: 40 },
  { key: 'EWAY_ENVIRONMENT_TYPE', label: 'E-Way Environment', tab: 'eway', maxLen: 20 },
  { key: 'API_LINK_EWAY_IRN_NO', label: 'API Link E-Way IRN No.', tab: 'eway', maxLen: 200 },
  { key: 'API_LINK_EWAY_PRINT', label: 'API Link E-Way Print', tab: 'eway', maxLen: 200 },
  { key: 'API_LINK_EINV_PRINT', label: 'API Link E-Inv Print', tab: 'eway', maxLen: 200 },
];

export function gstProfileFieldsForTab(tabId) {
  return GST_PROFILE_FIELD_SPECS.filter((f) => f.tab === tabId);
}
