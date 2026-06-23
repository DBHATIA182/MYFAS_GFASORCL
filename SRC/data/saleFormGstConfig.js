/** VFP DO FORM saleform_Gst WITH 'SALE' — SALEFORM_GST rows for sale invoice UI. */
export const SALE_FORM_GST_MODE = 'SALE';

/** Columns cannot be hidden (VFP AfterRowColChange on SUP_DATE). */
export const SALE_FORM_GST_HIDE_RESTRICTED = ['SUP_DATE'];

export const SALE_FORM_GST_GRID_COLUMNS = [
  { key: 'F_NAME', label: 'Field Name', readOnly: true },
  { key: 'ADD_YN', label: 'Add (Y/N)', yn: true },
  { key: 'EDIT_YN', label: 'Edit (Y/N)', yn: true },
  { key: 'S_NO', label: 'Sr.No.', numeric: true },
  { key: 'HIDE_COL', label: 'Hide Y/N', yn: true },
];
