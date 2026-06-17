/** Shared godown master field helpers (VFP DO FORM godown). */

export const GODOWN_EXPORT_COLUMNS = [
  ['GOD_CODE', 'God.Code'],
  ['GOD_NAME', 'God.Name'],
  ['GOD_NAME1', 'Company Name'],
  ['GOD_ADD1', 'Address 1'],
  ['GOD_ADD2', 'Address 2'],
  ['GOD_LOCATION', 'Location'],
  ['GOD_PIN_CODE', 'Pin Code'],
  ['GOD_STATE_CODE', 'State Code'],
  ['GOD_STATE', 'State Name'],
  ['GOD_GST_NO', 'Gst No.'],
  ['GOD_TEL_NO_1', 'Tel.No.1'],
  ['GOD_TEL_NO_2', 'Tel.No.2'],
  ['GOD_FSSAI_NO', 'Fssai No.'],
  ['GOD_B_TYPE', 'Sale Bill Type'],
  ['GOD_CODE_MAIN', 'Main Godown'],
];

const GODOWN_FIELD_ALIASES = {
  GOD_STATE: ['STATE'],
  GOD_STATE_CODE: ['STATE_CODE'],
};

export function capsTyping(v, max) {
  return String(v ?? '')
    .toUpperCase()
    .slice(0, max || 200);
}

export function capsSave(v, max) {
  return capsTyping(String(v ?? '').trim(), max);
}

export function emptyGodownForm() {
  return {
    GOD_CODE: '',
    GOD_NAME: '',
    GOD_NAME1: '',
    GOD_ADD1: '',
    GOD_ADD2: '',
    GOD_LOCATION: '',
    GOD_PIN_CODE: '',
    GOD_STATE_CODE: '',
    GOD_STATE: '',
    GOD_GST_NO: '',
    GOD_TEL_NO_1: '',
    GOD_TEL_NO_2: '',
    GOD_FSSAI_NO: '',
    GOD_B_TYPE: 'N',
    GOD_CODE_MAIN: '',
  };
}

export function stateCodesMatch(a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return parseInt(x, 10) === parseInt(y, 10);
  return x.toUpperCase() === y.toUpperCase();
}

export function normalizeGodownForm(row) {
  const base = emptyGodownForm();
  if (!row || typeof row !== 'object') return base;
  const src = { ...row };
  if (!String(src.GOD_STATE ?? '').trim() && String(src.STATE ?? src.state ?? '').trim()) {
    src.GOD_STATE = String(src.STATE ?? src.state ?? '').trim();
  }
  if (!String(src.GOD_STATE_CODE ?? '').trim() && String(src.STATE_CODE ?? src.state_code ?? '').trim()) {
    src.GOD_STATE_CODE = String(src.STATE_CODE ?? src.state_code ?? '').trim();
  }
  return { ...base, ...src };
}

export function pickGodownField(r, key) {
  const keys = [key, ...(GODOWN_FIELD_ALIASES[key] || [])];
  for (const k of keys) {
    const v = r[k] ?? r[k.toLowerCase()];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function lookupStateName(code, stateByCode) {
  const c = String(code ?? '').trim();
  if (!c || !stateByCode?.size) return '';
  if (stateByCode.has(c)) return stateByCode.get(c);
  if (/^\d+$/.test(c)) {
    const n = parseInt(c, 10);
    for (const [k, v] of stateByCode) {
      if (/^\d+$/.test(k) && parseInt(k, 10) === n) return v;
    }
  }
  return '';
}

export function enrichGodownRowState(row, stateByCode) {
  const state = pickGodownField(row, 'GOD_STATE');
  if (state) return row;
  const code = pickGodownField(row, 'GOD_STATE_CODE');
  const name = lookupStateName(code, stateByCode);
  if (!name) return row;
  return { ...row, GOD_STATE: name, god_state: name };
}

export function mapGodownRow(r) {
  const out = { ...r };
  for (const [key] of GODOWN_EXPORT_COLUMNS) {
    out[key] = pickGodownField(r, key);
  }
  return out;
}

export function toGodownExportRow(r) {
  const out = {};
  for (const [key, label] of GODOWN_EXPORT_COLUMNS) {
    out[label] = pickGodownField(r, key);
  }
  return out;
}

export function toGodownPdfRow(r) {
  const out = {};
  for (const [key] of GODOWN_EXPORT_COLUMNS) {
    out[key] = pickGodownField(r, key);
  }
  return out;
}
