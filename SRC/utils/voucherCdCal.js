/** FoxPro BROWCAL / CD_LESS — cash discount on bill balance (CUR_BAL), adj = Total − CD. */

export function calcCdAmtFromPercent(baseAmt, cdPer) {
  const base = Number(baseAmt) || 0;
  const pct = Number(cdPer) || 0;
  if (pct === 0 || base <= 0) return 0;
  return Math.round(((base * pct) / 100) * 100) / 100;
}

export function billBalanceTotal(row) {
  const total = Number(row?.TOTAL ?? row?.total ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  const cur = Number(row?.CUR_BAL ?? row?.cur_bal ?? 0) || 0;
  const intVal = Number(row?.INT_AMT ?? row?.int_amt ?? 0) || 0;
  return cur + intVal;
}

/** ADJ_AMT = Total − CD_AMT when CD_PER <> 0 (VFP CD_LESS / Billhlp). */
export function calcAdjAmtAfterCd({ balAmt, total, cdPer, cdAmt }) {
  const bal = Number(balAmt ?? 0) || 0;
  const tot = Number(total ?? 0) || 0;
  const pct = Number(cdPer) || 0;
  const cd =
    pct !== 0 ? calcCdAmtFromPercent(bal, pct) : Math.max(0, Number(cdAmt) || 0);
  const adj = tot - cd;
  return Math.round(Math.max(0, adj) * 100) / 100;
}

/** Apply CD_CAL to a pending-bill row; returns patched row fields. */
export function applyCdCalToBillRow(row) {
  const balAmt = Number(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
  const total = billBalanceTotal(row);
  const cdPerRaw = String(row.CD_PER ?? row.cd_per ?? '').replace(/,/g, '').trim();
  const cdPer = cdPerRaw === '' ? 0 : Number(cdPerRaw) || 0;
  const cdAmt = calcCdAmtFromPercent(balAmt, cdPer);
  const adjAmt = calcAdjAmtAfterCd({ balAmt, total, cdPer, cdAmt });
  return {
    CD_PER: cdPerRaw,
    CD_AMT: cdAmt > 0 ? cdAmt.toFixed(2) : '',
    ADJ_AMT: adjAmt > 0 ? adjAmt.toFixed(2) : '',
  };
}
