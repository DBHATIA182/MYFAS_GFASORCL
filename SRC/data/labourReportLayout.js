/**
 * Labour report grouped layout — matches VFP labrpt.frx (LOCAL / CENTRAL ARRIVAL / SALES).
 */

export const LABOUR_AMOUNT_KEYS = [
  'LRBAMT', 'LRKAMT', 'LRHAMT',
  'CRBAMT', 'CRKAMT', 'CRHAMT',
  'LSBAMT', 'LSKAMT', 'LSHAMT',
];

export const LABOUR_REPORT_GROUPS = [
  {
    id: 'local',
    label: 'LOCAL',
    pairs: [
      { qty: 'LRBAGS', amt: 'LRBAMT', qtyLabel: 'Bags', amtLabel: 'Amount' },
      { qty: 'LRKATA', amt: 'LRKAMT', qtyLabel: 'Katta', amtLabel: 'Amount' },
      { qty: 'LRHKAT', amt: 'LRHAMT', qtyLabel: 'HKatta', amtLabel: 'Amount' },
    ],
  },
  {
    id: 'central',
    label: 'CENTRAL ARRIVAL',
    pairs: [
      { qty: 'CRBAGS', amt: 'CRBAMT', qtyLabel: 'Bags', amtLabel: 'Amount' },
      { qty: 'CRKATA', amt: 'CRKAMT', qtyLabel: 'Katta', amtLabel: 'Amount' },
      { qty: 'CRHKAT', amt: 'CRHAMT', qtyLabel: 'HKatta', amtLabel: 'Amount' },
    ],
  },
  {
    id: 'sales',
    label: 'SALES',
    pairs: [
      { qty: 'LSBAGS', amt: 'LSBAMT', qtyLabel: 'Bags', amtLabel: 'Amount' },
      { qty: 'LSKATA', amt: 'LSKAMT', qtyLabel: 'Katta', amtLabel: 'Amount' },
      { qty: 'LSHKAT', amt: 'LSHAMT', qtyLabel: 'HKatta', amtLabel: 'Amount' },
    ],
  },
];

export function labourRowValue(row, key) {
  return row?.[key] ?? row?.[key?.toLowerCase?.()];
}

export function labourTotAmt(row) {
  return LABOUR_AMOUNT_KEYS.reduce((s, k) => {
    const n = Number(labourRowValue(row, k));
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);
}

export function fmtLabourQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  return Number.isInteger(n)
    ? n.toLocaleString('en-IN')
    : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtLabourAmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function labourVrDateMs(value) {
  if (value == null || value === '') return Number.NaN;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  }
  const s = String(value).trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])).getTime();
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    }
    return Number.NaN;
  }
  const ymdOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymdOnly) {
    return new Date(Number(ymdOnly[1]), Number(ymdOnly[2]) - 1, Number(ymdOnly[3])).getTime();
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return Number.NaN;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
}

export function sortLabourRowsByVrDate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const grand = list.filter((r) => Boolean(r?._isGrandTotal));
  const data = list
    .filter((r) => !r?._isGrandTotal)
    .slice()
    .sort((a, b) => {
      const da = labourVrDateMs(labourRowValue(a, 'VR_DATE'));
      const db = labourVrDateMs(labourRowValue(b, 'VR_DATE'));
      if (Number.isNaN(da) && Number.isNaN(db)) return 0;
      if (Number.isNaN(da)) return 1;
      if (Number.isNaN(db)) return -1;
      return da - db;
    });
  return [...data, ...grand];
}

export function labourGroupColSpan(group) {
  return (group.pairs?.length || 0) * 2;
}

export function labourTotalDataCols() {
  return LABOUR_REPORT_GROUPS.reduce((s, g) => s + labourGroupColSpan(g), 0) + 1;
}
