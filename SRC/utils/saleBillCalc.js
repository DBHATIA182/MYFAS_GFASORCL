/** VFP sale_gst / SALEFORM_GST — line weight/amount, GST, footer expense totals. */

export function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

export function round3(v) {
  return Math.round(num(v) * 1000) / 1000;
}

function asAmt(v) {
  const n = round2(v);
  return Number.isFinite(n) && n !== 0 ? String(n) : '';
}

function asWgt(v) {
  const n = round3(v);
  return Number.isFinite(n) && n !== 0 ? String(n) : '';
}

function isEmptyField(v) {
  return v == null || String(v).trim() === '';
}

export function calcNetWeight(gWeight, dWeight) {
  return Math.max(0, round3(num(gWeight) - num(dWeight)));
}

/**
 * VFP sale_gst AfterRowColChange packing formula (NCOLINDEX 13–15):
 *   G_WEIGHT / WEIGHT = ROUND(QNTY*PACKING, 3)
 *   then ÷100 when G_WGTKQ='Q', or when G_WGTKQ='X' and UNIT_TYPE='Q'
 */
export function computePackingWeights(qnty, packing, wgtKq, unitType) {
  const q = num(qnty);
  const pk = num(packing);
  if (q === 0 || pk === 0) return null;
  let w = round3(q * pk);
  const gk = String(wgtKq ?? '').trim().toUpperCase();
  const ut = String(unitType ?? '').trim().toUpperCase();
  if (gk === 'Q' || (gk === 'X' && ut === 'Q')) {
    w = round3(w / 100);
  }
  return { g_weight: w, weight: w };
}

/**
 * Legacy auto weight when packing is 0 — STATUS B/K/H factors.
 * Prefer computePackingWeights when packing ≠ 0.
 */
export function computeAutoWeight(qnty, status, packing, wgtKq, unitType) {
  const packed = computePackingWeights(qnty, packing, wgtKq, unitType);
  if (packed) return packed.weight;
  const q = num(qnty);
  if (q <= 0) return 0;
  const st = String(status ?? 'B').trim().toUpperCase().slice(0, 1) || 'B';
  if (st === 'B') return round3(q);
  if (st === 'K') return round3((q * 50) / 100);
  if (st === 'H') return round3((q * 30) / 100);
  return round3(q);
}

/** Line amount — VFP amountcal: CAL=2 → QNTY×RATE; else WEIGHT×RATE (÷100 unless G_WGTKQ='Q' or X+CAL=3). */
export function calcLineAmount(line, ctx = {}) {
  const rate = num(line.rate);
  if (!rate) return 0;
  const cal = Number(line.cal ?? line.CAL ?? 0);
  const saleCal = String(line.amt_cal ?? ctx.sale_cal ?? 'W').trim().toUpperCase();
  const byQty = cal === 2 || saleCal === 'Q';
  if (byQty) return round2(num(line.qnty) * rate);
  const weight = num(line.weight);
  const wgtKq = String(ctx.wgt_kq ?? ctx.G_WGTKQ ?? 'K').trim().toUpperCase();
  if (wgtKq === 'Q' || (wgtKq === 'X' && cal === 3)) return round2(weight * rate);
  return round2((weight * rate) / 100);
}

/**
 * VFP daneamtcal — set DANE_WGT from DANE master (BAGS/KATTA/HKATTA) × qty or weight.
 * Only recalculates on new bill or when DANE_WGT is 0.
 */
export function applyDaneAmtCal(line, daneRow, ctx = {}, opts = {}) {
  const dane = String(line.dane ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  if (!dane) {
    return { ...line, dane: '', dane_wgt: '', dane_amt: '' };
  }
  if (!daneRow) {
    return { ...line, dane: '', dane_wgt: '', dane_amt: '' };
  }
  const mode = String(opts.mode || ctx.mode || '').trim().toLowerCase();
  const existingWgt = num(line.dane_wgt);
  if (mode !== 'new' && existingWgt !== 0 && !opts.force) {
    return { ...line, dane };
  }

  const bags = num(daneRow.bags ?? daneRow.BAGS);
  const katta = num(daneRow.katta ?? daneRow.KATTA);
  const hkatta = num(daneRow.hkatta ?? daneRow.HKATTA);
  const wgtKq = String(ctx.wgt_kq ?? ctx.G_WGTKQ ?? 'K').trim().toUpperCase();
  const status = String(line.status ?? 'B').trim().toUpperCase().slice(0, 1) || 'B';
  const weight = num(line.weight);
  const qnty = num(line.qnty);
  let daneWgt = 0;

  if (dane === 'W' || dane === 'X' || dane === 'Y' || dane === 'Z') {
    daneWgt = wgtKq === 'Q' ? round3((bags / 1000) * weight) : round3((bags / 100) * weight);
  } else if (existingWgt === 0 || mode === 'new' || opts.force) {
    if (status === 'B') {
      daneWgt = wgtKq === 'Q' ? round3((qnty * bags) / 100) : round3(qnty * bags);
    } else if (status === 'K') {
      daneWgt = wgtKq === 'Q' ? round3((qnty * katta) / 100) : round3(qnty * katta);
    } else if (status === 'H') {
      daneWgt = wgtKq === 'Q' ? round3((qnty * hkatta) / 100) : round3(qnty * hkatta);
    }
  } else {
    daneWgt = existingWgt;
  }

  return {
    ...line,
    dane,
    dane_wgt: daneWgt ? String(daneWgt) : '',
  };
}

/**
 * VFP AfterRowColChange NCOLINDEX 35 (E/D → E.DAmt):
 *   XE_DAMT = ROUND(QNTY * E_D, 2)
 *   REPLACE E_DAMT WITH XE_DAMT
 */
export function applyEdAmtCal(line) {
  const xeDamt = round2(num(line.qnty) * num(line.e_d));
  return {
    ...line,
    e_damt: xeDamt ? asAmt(xeDamt) : '',
  };
}

/**
 * VFP PROCEDURE paploo — P_AMT1/2/5/3 from PAPLOO1/2/5/3, plus DANE_AMT.
 * G_WGTKQ='X': CAL=3 → weight×rate style (no ÷100); CAL=2 → qty; else weight÷100.
 * Else (legacy): G_WGTKQ='Q' → no ÷100; else CAL=2 qty / weight÷100.
 */
export function applyPaplooCal(line, ctx = {}) {
  const wgtKq = String(ctx.wgt_kq ?? ctx.G_WGTKQ ?? 'K').trim().toUpperCase();
  const cal = Number(line.cal ?? line.CAL ?? 1) || 1;
  const weight = num(line.weight);
  const qnty = num(line.qnty);
  const rate = num(line.rate);
  const p1 = num(line.paploo1);
  const p2 = num(line.paploo2);
  const p3 = num(line.paploo3);
  const p4 = num(line.paploo4);
  const p5 = num(line.paploo5);
  const daneWgt = num(line.dane_wgt);
  const daneLess =
    String(ctx.dane_less_paploo ?? ctx.G_DANE_LESS_PAPLOO ?? 'N')
      .trim()
      .toUpperCase() === 'Y';

  const direct = wgtKq === 'X' ? cal === 3 : wgtKq === 'Q';
  const byQty = !direct && cal === 2;

  let xp1;
  let xp2;
  let xp5;
  let xp3;
  if (direct) {
    xp1 = round2(weight * p1);
    xp2 = round2(weight * p2);
    xp5 = round2(weight * p5);
    xp3 = round2(p3 * (rate - (p1 + p2 + p5)));
  } else {
    xp1 = byQty ? round2(qnty * p1) : round2((weight * p1) / 100);
    xp2 = byQty ? round2(qnty * p2) : round2((weight * p2) / 100);
    xp5 = byQty ? round2(qnty * p5) : round2((weight * p5) / 100);
    xp3 = round2((p3 * (rate - (p1 + p2 + p5))) / 100);
  }

  const daneDirect = wgtKq === 'X' ? cal === 3 : wgtKq === 'Q';
  let daneAmt = 0;
  if (daneWgt) {
    if (daneLess) {
      const netRate = rate - (p1 + p2 + p5 + p4);
      daneAmt = daneDirect ? round2(daneWgt * netRate) : round2((daneWgt * netRate) / 100);
    } else {
      daneAmt = daneDirect ? round2(daneWgt * rate) : round2((daneWgt * rate) / 100);
    }
  }

  return {
    ...line,
    p_amt1: xp1 ? asAmt(xp1) : '',
    p_amt2: xp2 ? asAmt(xp2) : '',
    p_amt3: xp3 ? asAmt(xp3) : '',
    p_amt5: xp5 ? asAmt(xp5) : '',
    dane_amt: daneAmt ? asAmt(daneAmt) : '',
  };
}

/** VFP stock guard — new bill + G_NEG_STOCK='N': qty/weight may not exceed lot balance. */
export function exceedsLotStock(line, ctx = {}) {
  const neg = String(ctx.neg_stock ?? ctx.G_NEG_STOCK ?? 'N').trim().toUpperCase();
  if (neg === 'Y') return false;
  const qw = String(ctx.neg_stock_qw ?? ctx.G_NEG_STOCK_QW ?? 'Q').trim().toUpperCase();
  const balQty = line.b_qty;
  const balWgt = line.b_wgt;
  if (qw === 'Q') {
    if (balQty == null || balQty === '') return false;
    return num(line.qnty) > num(balQty);
  }
  if (balWgt == null || balWgt === '') return false;
  return num(line.weight) > num(balWgt);
}

/**
 * Line recalc:
 * 1. WEIGHT — packing×qty (VFP) sets both G_WEIGHT and WEIGHT; else net / auto.
 * 2. AMOUNT = RATE × (Weight or Qty per amt_cal).
 * 3. DIS_AMT / GST from amount.
 */
export function recalcLine(line, ctx = {}, opts = {}) {
  let next = { ...line };
  const mode = String(opts.mode || ctx.mode || '').trim().toLowerCase();

  // VFP: (new && packing≠0 && qnty≠0) OR (edit && packing≠0 && packing/qnty changed)
  const pk = num(next.packing);
  const qn = num(next.qnty);
  const packingChanged =
    opts.prevLine != null && num(opts.prevLine.packing) !== pk;
  const qntyChanged = opts.prevLine != null && num(opts.prevLine.qnty) !== qn;
  const shouldApplyPacking =
    pk !== 0 &&
    qn !== 0 &&
    (mode !== 'edit'
      ? Boolean(opts.packingTouched || opts.qntyTouched || opts.applyPacking)
      : packingChanged || qntyChanged);

  if (shouldApplyPacking && !opts.weightTouched && !opts.gWeightTouched) {
    const packed = computePackingWeights(qn, pk, ctx.wgt_kq ?? ctx.G_WGTKQ, next.unit_type);
    if (packed) {
      next.g_weight = asWgt(packed.g_weight);
      next.weight = asWgt(packed.weight);
      next.weight_manual = false;
      if (opts.onPackingApplied) opts.onPackingApplied(mode);
    }
  }

  const gWeight = num(next.g_weight);
  const dWeight = num(next.d_weight);
  let weight = num(next.weight);
  if (gWeight || dWeight) {
    // After packing sets both equal; D_WEIGHT nets when present (VFP ncol 15)
    if (dWeight) weight = calcNetWeight(gWeight || weight, dWeight);
    else if (!next.weight_manual && !opts.weightTouched) weight = gWeight || weight;
  } else if (!next.weight_manual && !opts.weightTouched) {
    const auto = computeAutoWeight(next.qnty, next.status, next.packing, ctx.wgt_kq, next.unit_type);
    if (auto) weight = auto;
  }

  const amount = calcLineAmount({ ...next, weight }, ctx);
  const disPer = num(next.dis_per);
  const disAmt = round2((amount * disPer) / 100);
  const taxable = amount - disAmt;
  const cgstPer = num(next.cgst_per);
  const sgstPer = num(next.sgst_per);
  const igstPer = num(next.igst_per);
  const cgstAmt = round2((taxable * cgstPer) / 100);
  const sgstAmt = round2((taxable * sgstPer) / 100);
  const igstAmt = round2((taxable * igstPer) / 100);

  next = {
    ...next,
    weight: weight ? asWgt(weight) : '',
    amount: amount ? asAmt(amount) : '',
    dis_amt: disPer || disAmt ? asAmt(disAmt) : '',
    cgst_amt: cgstPer || cgstAmt ? asAmt(cgstAmt) : '',
    sgst_amt: sgstPer || sgstAmt ? asAmt(sgstAmt) : '',
    igst_amt: igstPer || igstAmt ? asAmt(igstAmt) : '',
  };

  // Stock check after weight settle (new only)
  if (mode === 'new' && exceedsLotStock(next, ctx) && !opts.skipStockCheck) {
    if (opts.onStockExceed) opts.onStockExceed();
    next = {
      ...next,
      qnty: '',
      weight: '',
      g_weight: '',
      amount: '',
      dis_amt: '',
      cgst_amt: '',
      sgst_amt: '',
      igst_amt: '',
    };
  }

  // VFP paploo — P_AMT1/2/3/5 + DANE_AMT from paploo rates
  if (!opts.skipPaploo) {
    next = applyPaplooCal(next, ctx);
  }

  // VFP ncol 35 — E_DAMT = ROUND(QNTY * E_D, 2)
  // Recalc when qty/E_D drive it; don't clobber a direct E.DAmt edit.
  if (!opts.skipEdAmt && !opts.eDamtTouched) {
    next = applyEdAmtCal(next);
  }

  return next;
}

/** Sum OTH_EXP1…OTH_EXP10 (and legacy single oth_exp if set). */
export function sumOthExpTotal(footer = {}) {
  const f = footer || {};
  let total = 0;
  for (let i = 1; i <= 10; i += 1) {
    total += num(f[`oth_exp${i}`]);
  }
  // Legacy single OTH_EXP column — only if 1–10 are all blank
  if (!total) total = num(f.oth_exp);
  return round2(total);
}

/** Sum grid + footer expenses → BILL_AMT / NET_PAYABLE (mirrors VFP sale_gst sumvalue). */
export function sumSaleGrid(lines, footer = {}, ctx = {}) {
  const sums = {
    qnty: 0,
    weight: 0,
    g_weight: 0,
    amount: 0,
    dis_amt: 0,
    cgst_amt: 0,
    sgst_amt: 0,
    igst_amt: 0,
    dane_wgt: 0,
  };
  for (const ln of lines || []) {
    if (!String(ln.item_code ?? '').trim()) continue;
    sums.qnty += num(ln.qnty);
    sums.weight += num(ln.weight);
    sums.g_weight += num(ln.g_weight);
    sums.amount += num(ln.amount);
    sums.dis_amt += num(ln.dis_amt);
    sums.cgst_amt += num(ln.cgst_amt);
    sums.sgst_amt += num(ln.sgst_amt);
    sums.igst_amt += num(ln.igst_amt);
    sums.dane_wgt += num(ln.dane_wgt);
  }

  const f = footer || {};
  const labour = num(f.labour);
  const freight = num(f.freight);
  const ins = num(f.ins);
  const commAmt = num(f.comm_amt);
  const brokAmt = num(f.brok_amt);
  const arhAmt = num(f.arh_amt);
  const othExpTotal = sumOthExpTotal(f);
  const roundOff = num(f.round_off);
  const lessAmt =
    num(f.l_dane_amt) + num(f.l_cd_amt) + num(f.l_ch_amt) + num(f.l_qc_amt) + num(f.ld_amt);

  const netAmount = round2(sums.amount - sums.dis_amt + sums.cgst_amt + sums.sgst_amt + sums.igst_amt);
  const billAmt = round2(
    netAmount + labour + freight + ins + commAmt + brokAmt + arhAmt + othExpTotal + roundOff + num(f.e_lab_amt) - lessAmt
  );
  const netPayable = round2(billAmt - num(f.tds_amt));

  return {
    ...sums,
    oth_exp_total: othExpTotal,
    net_amount: netAmount,
    bill_amt: billAmt,
    net_payable: netPayable,
  };
}

/**
 * Expenses Summary auto-calcs — Commission / Brokerage % of merchandise amount, Tds on bill amount.
 * @returns {{ footer: object }}
 */
export function recalcExpenseSummary(footer, totals = {}, _ctx = {}) {
  const next = { ...(footer || {}) };
  const mamt = num(totals.amount);

  const commPer = num(next.comm_per);
  if (commPer) next.comm_amt = asAmt(round2((mamt * commPer) / 100));

  const brokPer = num(next.brok_per);
  if (brokPer) next.brok_amt = asAmt(round2((mamt * brokPer) / 100));

  const arhPer = num(next.arh_per);
  if (arhPer) next.arh_amt = asAmt(round2((mamt * arhPer) / 100));

  if (!next.tds_on_manual) {
    next.tds_on_amt = totals.bill_amt ? asAmt(totals.bill_amt) : '';
  }
  const tdsBase = num(next.tds_on_amt);
  const tdsPer = num(next.tds_per);
  const tdsAmt = round2((tdsBase * tdsPer) / 100);
  next.tds_amt = tdsPer || tdsAmt ? asAmt(tdsAmt) : '';

  return { footer: next };
}

/** Focus-chain keys for Other Expenses tab (OTH_EXP1–10). */
export function getOthExpensesFocusKeys(visibleOthExp = null) {
  const keys = [];
  for (let i = 1; i <= 10; i += 1) {
    if (Array.isArray(visibleOthExp) && !visibleOthExp.includes(i)) continue;
    keys.push(`oe-oth_cd${i}`, `oe-oth_exp${i}`);
  }
  return keys;
}

/** Focus-chain keys for Expenses Summary tab (top → bottom). */
export function getExpenseSummaryFocusKeys() {
  return [
    'ft-dis_code',
    'ft-cgst_code',
    'ft-sgst_code',
    'ft-igst_code',
    'ft-labour_code',
    'ft-labour',
    'ft-freight_code',
    'ft-freight',
    'ft-ins_code',
    'ft-ins',
    'ft-comm_per',
    'ft-comm_code',
    'ft-comm_amt',
    'ft-brok_per',
    'ft-brok_code',
    'ft-brok_amt',
    'ft-arh_per',
    'ft-arh_code',
    'ft-arh_amt',
    'ft-round_off',
    'ft-tds_on_amt',
    'ft-tds_per',
    'ft-tds_code',
    'ft-tds_amt',
  ];
}

/** Focus-chain keys for Bill Expenses tab (VFP left/middle/eway strip). */
export function getBillExpensesFocusKeys() {
  return [
    'be-dane_code',
    'be-p_code1',
    'be-p_amt1',
    'be-p_code2',
    'be-p_amt2',
    'be-p_code3',
    'be-p_amt3',
    'be-p_code5',
    'be-p_amt5',
    'be-gr_no',
    'be-form',
    'be-tpt',
    'be-truck',
    'be-rl_type',
    'be-remarks',
    'be-tot_wgt',
    'be-tot_fgt',
    'be-adv_fgt',
    'be-to_pay',
    'be-e_lab_rate',
    'be-e_lab_cal',
    'be-e_lab_amt',
    'be-l_d_code',
    'be-l_c_code',
    'be-l_dane',
    'be-l_dane_code',
    'be-l_dane_amt',
    'be-l_dane_wgt',
    'be-l_cd_per',
    'be-l_cd_code',
    'be-l_cd_amt',
    'be-l_ch_per',
    'be-l_ch_code',
    'be-l_ch_amt',
    'be-l_qc_per',
    'be-l_qc_code',
    'be-l_qc_amt',
    'be-ld_per',
    'be-ld_code',
    'be-ld_amt',
    'be-saleman',
    'be-disp_from',
    'be-irn_no',
    'be-ack_no',
    'be-eway_bill_no',
    'be-eway_date',
    'be-eway_valid',
    'be-qr_code',
    'be-eway_reason',
    'be-eway_close',
  ];
}

export function accountDisplayName(list, code) {
  const c = String(code ?? '').trim();
  if (!c) return '';
  const hit = (list || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === c);
  return hit ? String(hit.NAME ?? hit.name ?? '').trim() : '';
}

/** Fill from ITEMMAST on item pick (VFP sale_gst AfterRowColChange ncol 5). */
export function applyItemmastToLine(line, itemRow, { accounts = [], partyLc = 'L', mode = '' } = {}) {
  if (!itemRow) return line;
  const next = { ...line };
  const isNew = String(mode || '').trim().toLowerCase() === 'new';
  next.item_name = String(itemRow.ITEM_NAME ?? itemRow.item_name ?? next.item_name ?? '').trim();

  const packing = num(itemRow.PACKING ?? itemRow.packing ?? itemRow.UNIT_WGT ?? itemRow.unit_wgt);
  if (packing && !num(next.packing)) {
    next.packing = String(packing);
  }
  if (!String(next.unit_type ?? '').trim()) {
    next.unit_type = String(itemRow.UNIT_TYPE ?? itemRow.unit_type ?? '').trim().toUpperCase();
  }

  // VFP: IF M_SRATE<>0 REPLACE S_RATE (new bill)
  const sRate = num(itemRow.S_RATE ?? itemRow.s_rate ?? itemRow.SALE_RATE ?? itemRow.sale_rate);
  if (sRate && (isNew || !num(next.s_rate))) {
    next.s_rate = String(sRate);
  }

  // VFP: IF TAXPER<>0 AND all GST % blank → L: CGST/SGST = TAXPER/2; else IGST = TAXPER
  const taxPer = num(itemRow.TAX_PER ?? itemRow.tax_per);
  if (
    taxPer &&
    !num(next.cgst_per) &&
    !num(next.sgst_per) &&
    !num(next.igst_per)
  ) {
    const lc = String(partyLc ?? 'L').trim().toUpperCase().slice(0, 1) || 'L';
    if (lc === 'L') {
      const half = round2(taxPer / 2);
      next.cgst_per = half ? String(half) : '';
      next.sgst_per = half ? String(half) : '';
      next.igst_per = '';
    } else {
      next.igst_per = String(taxPer);
      next.cgst_per = '';
      next.sgst_per = '';
    }
  }

  if (isNew) {
    const comm = num(itemRow.COMMISSION ?? itemRow.commission);
    const brok = num(itemRow.BROKERAGE ?? itemRow.brokerage);
    if (comm) next.comm_per = String(comm);
    if (brok) next.brok_per = String(brok);
    const amtCal = String(itemRow.AMT_CAL ?? itemRow.amt_cal ?? '').trim().toUpperCase().slice(0, 1);
    if (amtCal === 'W') next.cal = 1;
    else if (amtCal === 'Q') next.cal = 2;
  }

  const sCode = String(itemRow.S_CODE ?? itemRow.s_code ?? '').trim().toUpperCase();
  if (!String(next.sup_code ?? '').trim() && sCode) {
    next.sup_code = sCode;
    next.sname = accountDisplayName(accounts, sCode);
  }
  return next;
}

/** Any footer amount that must post to a ledger requires an A/c code. */
export function validateSaleLedgerExpenseCodes({ footer = {}, totals = {} } = {}) {
  const f = footer || {};
  const need = (amt, code, label) => {
    if (!num(amt)) return '';
    if (String(code ?? '').trim()) return '';
    return `${label} has amount but A/c code is blank.`;
  };
  const t = totals || {};
  const checks = [
    [f.labour, f.labour_code, 'Labour'],
    [f.freight, f.freight_code, 'Freight'],
    [f.ins, f.ins_code, 'Insurance'],
    [f.comm_amt, f.comm_code, 'Commission'],
    [f.brok_amt, f.brok_code, 'Brokerage'],
    [f.arh_amt, f.arh_code, 'Arhatiya'],
    [f.tds_amt, f.tds_code, 'TDS'],
    [t.dis_amt, f.dis_code, 'Discount'],
    [t.cgst_amt, f.cgst_code, 'CGST'],
    [t.sgst_amt, f.sgst_code, 'SGST'],
    [t.igst_amt, f.igst_code, 'IGST'],
  ];
  for (const [amt, code, label] of checks) {
    const err = need(amt, code, label);
    if (err) return err;
  }
  for (let i = 1; i <= 10; i += 1) {
    const err = need(f[`oth_exp${i}`], f[`oth_cd${i}`], `Other Expense ${i}`);
    if (err) return err;
  }
  return '';
}
