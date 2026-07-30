/** Read bill row fields from pending-bill / Billhlp rows (Oracle column casing varies). */

function readBillField(row, logicalName) {
  if (!row || typeof row !== 'object') return undefined;
  const want = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === want) return row[k];
  }
  return undefined;
}

export function pickBillBType(row) {
  const raw = readBillField(row, 'B_TYPE');
  if (raw == null) return ' ';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (s.length === 1) return s.toUpperCase();
  const t = s.trim();
  return t ? t.slice(0, 1).toUpperCase() : ' ';
}

export function pickBillField(row, logicalName) {
  const raw = readBillField(row, logicalName);
  if (raw == null) return '';
  return typeof raw === 'string' ? raw.trim() : String(raw).trim();
}

/** VFP bill_hlp → grid: b_type as single visible character (WINDAL parity). */
export function gridBTypeFromBill(row) {
  const raw = readBillField(row, 'B_TYPE');
  const s = String(raw ?? ' ').trim();
  return s ? s.slice(0, 1).toUpperCase() : '';
}

/** Shape passed from Billhlp → voucher grid apply (VFP bill_hlp parity). */
export function normalizePickedBillRow(row) {
  if (!row || typeof row !== 'object') return row;
  const bType = pickBillBType(row);
  const bkCode = pickBillField(row, 'BK_CODE');
  return {
    ...row,
    BILL_DATE: row.BILL_DATE ?? row.bill_date,
    BILL_NO: row.BILL_NO ?? row.bill_no,
    B_TYPE: bType,
    b_type: bType,
    BK_CODE: bkCode,
    bk_code: bkCode,
    CUR_BAL: row.CUR_BAL ?? row.cur_bal,
    INT_AMT: row.INT_AMT ?? row.int_amt,
    ADJ_AMT: row.ADJ_AMT ?? row.adj_amt,
    DR_AMT: row.DR_AMT ?? row.dr_amt,
    CR_AMT: row.CR_AMT ?? row.cr_amt,
    CD_PER: row.CD_PER ?? row.cd_per,
    CD_AMT: row.CD_AMT ?? row.cd_amt,
  };
}
