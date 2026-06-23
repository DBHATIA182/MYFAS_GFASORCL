/** VFP DO FORM newcomp — new company installation fields. */

/** @type {Array<{ key: string, label: string, type?: string, maxLen?: number, readOnly?: boolean }>} */
export const NEWCOMP_FIELD_SPECS = [
  { key: 'COMP_CODE', label: 'Comp Code', readOnly: true },
  { key: 'COMP_YEAR', label: 'Financial Year', readOnly: true },
  { key: 'COMP_UID', label: 'Schema (comp_uid)', readOnly: true },
  { key: 'COMP_NAME', label: 'Company Name', maxLen: 60 },
  { key: 'COMP_ADD1', label: 'Address Line 1', maxLen: 50 },
  { key: 'COMP_ADD2', label: 'Address Line 2', maxLen: 50 },
  { key: 'COMP_TEL1', label: 'Tel. 1', maxLen: 30 },
  { key: 'COMP_TEL2', label: 'Tel. 2', maxLen: 30 },
  { key: 'COMP_TEL3', label: 'Tel. 3', maxLen: 30 },
  { key: 'COMP_TIN', label: 'Tin / IEC No.', maxLen: 20 },
  { key: 'COMP_PAN', label: 'PAN', maxLen: 12 },
  { key: 'COMP_TDSNO', label: 'TAN', maxLen: 20 },
  { key: 'COMP_PROP', label: 'Prop / Director / Partner', maxLen: 40 },
  { key: 'COMP_P_D', label: 'Administrator Password', type: 'password', maxLen: 30 },
  { key: 'COMP_S_DT', label: 'F.Year Start Date', type: 'date' },
  { key: 'COMP_E_DT', label: 'F.Year End Date', type: 'date' },
  { key: 'BANK_AC_NO', label: 'Bank A/c No.', maxLen: 30 },
  { key: 'EMAIL', label: 'Email', maxLen: 80 },
];

export const NEWCOMP_DATE_KEYS = new Set(
  NEWCOMP_FIELD_SPECS.filter((f) => f.type === 'date').map((f) => f.key)
);

export function emptyNewcompForm() {
  const out = {};
  for (const f of NEWCOMP_FIELD_SPECS) out[f.key] = '';
  return out;
}
