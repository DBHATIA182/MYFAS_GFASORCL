/** VFP purchase_gst — line amount, sumvalue, bill amount (MBAMT / NET_PAYABLE). */

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
  return Number.isFinite(n) ? String(n) : '';
}

function asWgt(v) {
  const n = round3(v);
  return Number.isFinite(n) ? String(n) : '';
}

function isEmptyField(v) {
  return v == null || String(v).trim() === '';
}

export function calcNetWeight(gWeight, dWeight) {
  return Math.max(0, round3(num(gWeight) - num(dWeight)));
}

/** Line amount from rate × qty or weight per AMT_CAL / G_WGTKQ. */
export function calcLineAmount(line, ctx = {}) {
  const rate = num(line.rate);
  if (!rate) return 0;
  const mode = String(line.amt_cal ?? ctx.pur_cal ?? ctx.wgt_kq ?? 'W')
    .trim()
    .toUpperCase();
  const base = mode === 'Q' ? num(line.qnty) : num(line.weight);
  return round2(base * rate);
}

/**
 * VFP purchase grid line calc:
 * 1. stk_weight — G_GROUP_CD=2 → G_weight-D_weight; else if empty → G_weight
 *    (when g_weight changes, keep syncing stk while it still matches prior g / was empty)
 * 2. DIS_AMT = ROUND(AMOUNT*DIS_PER/100,2)
 * 3. BARD_AMT = ROUND(QNTY*BARD_PER,2)
 * 4. LAB_AMT = ROUND(QNTY*LAB_PER,2)
 * 5. CGST_AMT = ROUND(((AMOUNT+LAB+BARD+FGT+INS+OTH)-DIS)*CGST_PER/100,2); copy CGST → SGST
 *
 * @param {object} opts.oldGWeight — g_weight before this edit (fixes onChange digit lock-in)
 * @param {boolean} opts.stkTouched — user is editing stk_weight directly
 */
export function recalcLine(line, ctx = {}, opts = {}) {
  const gWeight = num(line.g_weight);
  const dWeight = num(line.d_weight);
  let weight = num(line.weight);
  if (gWeight || dWeight) weight = calcNetWeight(gWeight, dWeight);

  const groupCd = Number(ctx.group_cd ?? ctx.G_GROUP_CD ?? 0) || 0;
  let stkWeight = num(line.stk_weight);
  if (groupCd === 2) {
    stkWeight = calcNetWeight(gWeight, dWeight);
  } else if (!opts.stkTouched) {
    const oldG = opts.oldGWeight != null ? num(opts.oldGWeight) : null;
    const stkEmpty = isEmptyField(line.stk_weight);
    const stillSynced = oldG != null && num(line.stk_weight) === oldG;
    // When g_weight is being edited, always follow G (fixes keystroke lock-in of "1" from "1000").
    if (opts.gWeightPatched || stkEmpty || stillSynced) {
      stkWeight = gWeight;
    }
  }

  const amount = calcLineAmount({ ...line, weight }, ctx);
  const qnty = num(line.qnty);
  const disPer = num(line.dis_per);
  const bardPer = num(line.bard_per);
  const labPer = num(line.lab_per);
  const cgstPer = num(line.cgst_per);

  const disAmt = round2((amount * disPer) / 100);
  const bardAmt = round2(qnty * bardPer);
  const labAmt = round2(qnty * labPer);
  const fgtAmt = num(line.fgt_amt);
  const insAmt = num(line.ins_amt);
  const othAmt = num(line.oth_amt);

  const taxable = amount + labAmt + bardAmt + fgtAmt + insAmt + othAmt - disAmt;
  const cgstAmt = round2((taxable * cgstPer) / 100);

  return {
    ...line,
    weight: weight ? asWgt(weight) : '',
    stk_weight: groupCd === 2 || !isEmptyField(line.stk_weight) || gWeight ? asWgt(stkWeight) : '',
    amount: amount ? asAmt(amount) : '',
    dis_amt: disPer || disAmt ? asAmt(disAmt) : '',
    bard_amt: bardPer || bardAmt ? asAmt(bardAmt) : '',
    lab_amt: labPer || labAmt ? asAmt(labAmt) : '',
    cgst_amt: cgstPer || cgstAmt ? asAmt(cgstAmt) : '',
    sgst_per: !isEmptyField(line.cgst_per) ? String(line.cgst_per) : '',
    sgst_amt: cgstPer || cgstAmt ? asAmt(cgstAmt) : '',
  };
}

/** Sum grid1 + footer — mirrors VFP PROCEDURE sumvalue. */
export function sumPurchaseGrid(lines, lineExpenses = [], footer = {}, ctx = {}) {
  const sums = {
    amount: 0,
    qnty: 0,
    weight: 0,
    g_weight: 0,
    stk_weight: 0,
    dane_amt: 0,
    dis_amt: 0,
    cgst_amt: 0,
    sgst_amt: 0,
    igst_amt: 0,
    lab_amt: 0,
    bard_amt: 0,
    fgt_amt: 0,
    ins_amt: 0,
    oth_amt: 0,
  };
  for (const ln of lines || []) {
    if (!String(ln.item_code ?? '').trim()) continue;
    sums.amount += num(ln.amount);
    sums.qnty += num(ln.qnty);
    sums.weight += num(ln.weight);
    sums.g_weight += num(ln.g_weight);
    sums.stk_weight += num(ln.stk_weight);
    sums.dane_amt += num(ln.dane_amt);
    sums.dis_amt += num(ln.dis_amt);
    sums.cgst_amt += num(ln.cgst_amt);
    sums.sgst_amt += num(ln.sgst_amt);
    sums.igst_amt += num(ln.igst_amt);
    sums.lab_amt += num(ln.lab_amt);
    sums.bard_amt += num(ln.bard_amt);
    sums.fgt_amt += num(ln.fgt_amt);
    sums.ins_amt += num(ln.ins_amt);
    sums.oth_amt += num(ln.oth_amt);
  }

  let misc_exp = 0;
  for (const row of lineExpenses || []) {
    misc_exp += num(row.amount);
  }

  const f = footer || {};
  const purExpType = Number(ctx.pur_exp_type ?? 0) || 0;
  const comm = num(f.comm_amt);
  const mud = num(f.mud_amt);
  const tcs = num(f.tcs_amt);
  const oth1 = num(f.oth_exp_1);
  const oth2 = num(f.oth_exp_2);
  const oth3 = num(f.oth_exp_3);
  const oth4 = num(f.oth_exp_4);
  const oth5 = num(f.oth_exp_5);
  const oth6 = num(f.oth_exp_6);
  const oth7 = num(f.oth_exp_7);
  const oth8 = num(f.oth_exp_8);

  let mbamt;
  if (purExpType === 2) {
    mbamt =
      sums.amount +
      comm +
      misc_exp +
      sums.cgst_amt +
      sums.igst_amt +
      sums.sgst_amt +
      sums.bard_amt +
      sums.fgt_amt +
      sums.lab_amt +
      sums.ins_amt +
      sums.oth_amt +
      tcs -
      mud -
      sums.dis_amt;
  } else if (purExpType === 1) {
    mbamt =
      sums.amount +
      oth1 +
      oth2 +
      oth3 +
      oth4 +
      comm +
      misc_exp +
      sums.cgst_amt +
      sums.sgst_amt +
      sums.igst_amt +
      sums.lab_amt +
      sums.fgt_amt +
      sums.bard_amt +
      sums.ins_amt +
      sums.oth_amt +
      tcs -
      mud -
      sums.dis_amt;
  } else {
    mbamt =
      sums.amount +
      oth1 +
      oth2 +
      comm +
      misc_exp +
      sums.cgst_amt +
      sums.igst_amt +
      sums.sgst_amt +
      sums.fgt_amt +
      sums.bard_amt +
      sums.lab_amt +
      sums.ins_amt +
      sums.oth_amt +
      tcs -
      mud -
      oth3 -
      oth4 -
      sums.dis_amt;
  }
  mbamt += oth5 + oth6 + oth7 + oth8;

  const dnExpType = Number(ctx.pur_debit_note_exp_type ?? 0) || 0;
  if (dnExpType === 2) {
    mbamt -=
      num(f.brok_paid) +
      num(f.mandi_exp) +
      num(f.labour_exp) +
      num(f.bardana_exp) +
      num(f.freight_paid) +
      num(f.cd_amount) +
      num(f.dharam_kanta) +
      num(f.tulwai_exp) +
      num(f.round_off);
  }

  const net_payable = Math.round((mbamt - num(f.ntds_amt)) * 100) / 100;
  mbamt = Math.round(mbamt * 100) / 100;

  const tw = sums.weight || 1;
  const wgtKq = String(ctx.wgt_kq ?? 'W').trim().toUpperCase();
  const pur_avg_rate =
    wgtKq === 'Q'
      ? Math.round((mbamt / tw) * 100) / 100
      : Math.round((mbamt / tw) * 100 * 100) / 100;

  const m_g_amount = round2(
    sums.amount +
      sums.lab_amt +
      sums.bard_amt +
      sums.fgt_amt +
      sums.ins_amt +
      sums.oth_amt -
      sums.dis_amt +
      sums.cgst_amt +
      sums.sgst_amt +
      sums.igst_amt
  );

  return {
    ...sums,
    misc_exp,
    m_g_amount,
    mbamt,
    bill_amt: mbamt,
    net_payable,
    pur_avg_rate: Number.isFinite(pur_avg_rate) ? pur_avg_rate : 0,
  };
}

/**
 * VFP Expenses Summary LostFocus calcs (comm / mud / brok_paid / cd / ntds).
 * @returns {{ footer: object, alert?: { message: string, focusKey: string } }}
 */
export function recalcExpenseSummary(footer, totals = {}, ctx = {}, lines = [], _opts = {}) {
  const next = { ...(footer || {}) };
  let alert;

  const mamt = num(totals.amount);
  const tw = num(totals.weight);
  const tq = num(totals.qnty);
  const sw = num(totals.stk_weight);
  const mGAmount = num(totals.m_g_amount);
  const wgtKq = String(ctx.wgt_kq ?? ctx.G_WGTKQ ?? 'W').trim().toUpperCase();
  const tdsRound = num(ctx.tds_round_off_value ?? ctx.G_TDS_ROUND_OFF_VALUE);

  const commPer = num(next.comm_per);
  if (commPer !== 0) {
    const cal = String(next.comm_cal ?? '').trim().toUpperCase();
    if (cal === 'Q' || cal === 'W' || cal === 'A' || cal === 'M') {
      if (cal === 'W') next.comm_amt = asAmt(round2(tw * commPer));
      else if (cal === 'Q') next.comm_amt = asAmt(round2(tq * commPer));
      else if (cal === 'M') {
        /* manual — leave COMM_AMT */
      } else {
        next.comm_amt = asAmt(round2((mamt * commPer) / 100));
      }
    } else {
      alert = {
        message: 'Enter (Q)ty / (W)eight / (A)mount Only / (M)anual',
        focusKey: 'ft-comm_per',
      };
    }
  }

  if (num(next.mud_amt) === 0) {
    next.mud_amt = asAmt(round2((mamt * num(next.mud_per)) / 100));
    if (isEmptyField(next.mud_code)) {
      const first = (lines || []).find((ln) => String(ln.pur_code ?? '').trim());
      if (first) next.mud_code = String(first.pur_code).trim().toUpperCase();
    }
  }

  const brokPer = num(next.brok_paid_per);
  if (brokPer !== 0) {
    const cal = String(next.brok_cal ?? '').trim().toUpperCase();
    if (cal === 'Q') {
      next.brok_paid = asAmt(round2(tq * brokPer));
    } else if (cal === 'W') {
      next.brok_paid =
        wgtKq === 'K'
          ? asAmt(round2((sw * brokPer) / 100))
          : asAmt(round2(sw * brokPer));
    } else if (cal === 'A') {
      next.brok_paid = asAmt(round2((mamt * brokPer) / 100));
    } else {
      next.brok_paid = asAmt(round2((mGAmount * brokPer) / 100));
    }
  }

  const cdPer = num(next.cd_per);
  if (cdPer !== 0) {
    next.cd_amount = asAmt(round2((mGAmount * cdPer) / 100));
  }

  // VFP: IF NTDS_ON_AMT=0 → MAMT. Auto-follow merchandise amount until user edits TdsOnAmount.
  if (!next.ntds_on_manual) {
    next.ntds_on_amt = mamt ? asAmt(mamt) : '';
  }

  const ntdsBase = num(next.ntds_on_amt);
  const ntdsPer = num(next.ntds_per);
  let ntdsAmt = round2((ntdsBase * ntdsPer) / 100);
  if (tdsRound !== 0) {
    const whole = Math.trunc(ntdsAmt);
    const frac = ntdsAmt - whole;
    ntdsAmt = frac > tdsRound ? whole + 1 : whole;
  }
  next.ntds_amt = ntdsPer || ntdsAmt || ntdsBase ? asAmt(ntdsAmt) : '';

  return { footer: next, alert };
}

/** Focus-chain keys for Expenses Summary editable fields (top → bottom). */
export function getExpenseSummaryFocusKeys(opts = {}) {
  if (opts.bardana) {
    const keys = [
      'ft-dis_code',
      'ft-cgst_code',
      'ft-sgst_code',
      'ft-igst_code',
      'ft-comm_per',
      'ft-comm_cal',
      'ft-comm_code',
      'ft-comm_amt',
      'ft-mud_per',
      'ft-mud_code',
      'ft-mud_amt',
    ];
    for (let i = 1; i <= 8; i += 1) {
      keys.push(`ft-oth_cd_${i}`, `ft-oth_exp_${i}`);
    }
    keys.push('ft-ntds_on_amt', 'ft-ntds_per', 'ft-ntds_code', 'ft-ntds_amt');
    return keys;
  }
  const keys = [
    'ft-dis_code',
    'ft-cgst_code',
    'ft-sgst_code',
    'ft-igst_code',
    'ft-comm_per',
    'ft-comm_cal',
    'ft-comm_code',
    'ft-comm_amt',
    'ft-mud_per',
    'ft-mud_code',
    'ft-mud_amt',
  ];
  for (let i = 1; i <= 8; i += 1) {
    keys.push(`ft-oth_cd_${i}`, `ft-oth_exp_${i}`);
  }
  keys.push('ft-brok_paid_per', 'ft-brok_cal', 'ft-brok_paid_code', 'ft-brok_paid');
  for (const [code, amt] of [
    ['mandi_exp_code', 'mandi_exp'],
    ['labour_exp_code', 'labour_exp'],
    ['bardana_exp_code', 'bardana_exp'],
    ['freight_paid_code', 'freight_paid'],
    ['cd_amount_code', 'cd_amount'],
    ['dharam_kanta_code', 'dharam_kanta'],
    ['tulwai_code', 'tulwai_exp'],
    ['round_off_code', 'round_off'],
  ]) {
    if (code === 'cd_amount_code') keys.push('ft-cd_per');
    keys.push(`ft-${code}`, `ft-${amt}`);
  }
  if (!opts.hideTds) {
    keys.push('ft-ntds_on_amt', 'ft-ntds_per', 'ft-ntds_code', 'ft-ntds_amt');
  }
  return keys;
}

/** Focus-chain keys for Bill Expenses tab (col1 → col2 → col3 → bottom). */
export function getBillExpensesFocusKeys(opts = {}) {
  if (opts.bardana) {
    return ['be-gr_no', 'be-tpt', 'be-truck', 'be-remarks', 'be-p_bill_no_file_path'];
  }
  return [
    'be-gr_no',
    'be-tpt',
    'be-truck',
    'be-form',
    'be-freight_hdr',
    'be-f_dr_code',
    'be-f_cr_code',
    'be-labour',
    'be-l_d_code',
    'be-l_c_code',
    'be-tds_comm',
    'be-tds_per',
    'be-tds_amt',
    'be-sur_per',
    'be-sur_amt',
    'be-edu_per',
    'be-edu_amt',
    'be-tds_code',
    'be-brok_rate',
    'be-brok_cal',
    'be-brok_amt',
    'be-brok_d_cd',
    'be-cost_code',
    'be-stk',
    'be-exp_cat',
    'be-bl_no',
    'be-job_no',
    'be-file_no',
    'be-bref_no',
    'be-remarks',
    'be-cform_amt',
    'be-p_bill_no_file_path',
  ];
}

export function accountDisplayName(list, code) {
  const c = String(code ?? '').trim();
  if (!c) return '';
  const hit = (list || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === c);
  return hit ? String(hit.NAME ?? hit.name ?? '').trim() : '';
}

/**
 * VFP Validate — any expense amount posting to LEDGER must have an A/c code (blank not accepted).
 * Returns first error message, or ''.
 */
export function validatePurchaseLedgerExpenseCodes({ footer = {}, lines = [], lineExpenses = [], totals = {} } = {}) {
  const f = footer || {};
  const need = (amt, code, label) => {
    if (!num(amt)) return '';
    if (String(code ?? '').trim()) return '';
    return `${label} has amount but A/c code is blank.`;
  };

  const checks = [
    [f.comm_amt, f.comm_code, 'Dami / Commission'],
    [f.mud_amt, f.mud_code, 'Mudat'],
    [f.brok_paid, f.brok_paid_code, 'BrokPaid'],
    [f.mandi_exp, f.mandi_exp_code, 'Mandiexp'],
    [f.labour_exp, f.labour_exp_code, 'Labourexp'],
    [f.bardana_exp, f.bardana_exp_code, 'Bardana'],
    [f.freight_paid, f.freight_paid_code, 'Freight'],
    [f.cd_amount, f.cd_amount_code, 'Cd.'],
    [f.dharam_kanta, f.dharam_kanta_code, 'DharmKanta'],
    [f.tulwai_exp, f.tulwai_code, 'Tulwaiexp'],
    [f.round_off, f.round_off_code, 'RoundOff'],
    [f.oth_exp_1, f.oth_cd_1, 'Others 1'],
    [f.oth_exp_2, f.oth_cd_2, 'Others 2'],
    [f.oth_exp_3, f.oth_cd_3, 'Others 3'],
    [f.oth_exp_4, f.oth_cd_4, 'Others 4'],
    [f.oth_exp_5, f.oth_cd_5, 'Others 5'],
    [f.oth_exp_6, f.oth_cd_6, 'Others 6'],
    [f.oth_exp_7, f.oth_cd_7, 'Others 7'],
    [f.oth_exp_8, f.oth_cd_8, 'Others 8'],
    [f.ntds_amt, f.ntds_code, 'TDS'],
    [f.tcs_amt, f.tcs_code, 'TCS'],
    [f.brok_amt, f.brok_d_cd, 'Broker Debit'],
    [f.freight_hdr ?? f.freight, f.f_dr_code, 'Freight Dr'],
    [f.freight_hdr ?? f.freight, f.f_cr_code, 'Freight Cr'],
    [f.labour, f.l_d_code, 'Labour Dr'],
    [f.labour, f.l_c_code, 'Labour Cr'],
  ];

  for (const [amt, code, label] of checks) {
    const err = need(amt, code, label);
    if (err) return err;
  }

  const t = totals || {};
  const taxChecks = [
    [t.dis_amt ?? f.dis_amt, f.dis_code, 'Discount'],
    [t.cgst_amt, f.cgst_code, 'CGST'],
    [t.sgst_amt, f.sgst_code, 'SGST'],
    [t.igst_amt, f.igst_code, 'IGST'],
  ];
  for (const [amt, code, label] of taxChecks) {
    const err = need(amt, code, label);
    if (err) return err;
  }

  // Line totals when footer codes used for GST/Discount (recompute if totals not passed)
  if (!Object.keys(t).length && Array.isArray(lines)) {
    const sum = (k) => lines.reduce((s, ln) => s + num(ln[k]), 0);
    for (const [amt, code, label] of [
      [sum('dis_amt'), f.dis_code, 'Discount'],
      [sum('cgst_amt'), f.cgst_code, 'CGST'],
      [sum('sgst_amt'), f.sgst_code, 'SGST'],
      [sum('igst_amt'), f.igst_code, 'IGST'],
    ]) {
      const err = need(amt, code, label);
      if (err) return err;
    }
  }

  for (const exp of lineExpenses || []) {
    if (!num(exp.amount)) continue;
    if (String(exp.code ?? '').trim()) continue;
    const name = String(exp.exp_name ?? '').trim() || 'Grid 2 expense';
    return `${name} has amount but A/c code is blank.`;
  }

  return '';
}

/** Fill item name + default pur/sale codes from ITEMMAST when line fields are blank. */
export function applyItemmastToLine(line, itemRow, { purAccounts = [], accounts = [] } = {}) {
  if (!itemRow) return line;
  const next = { ...line };
  next.item_name = String(itemRow.ITEM_NAME ?? itemRow.item_name ?? next.item_name ?? '').trim();
  const pCode = String(itemRow.P_CODE ?? itemRow.p_code ?? '').trim().toUpperCase();
  const sCode = String(itemRow.S_CODE ?? itemRow.s_code ?? '').trim().toUpperCase();
  if (!String(next.pur_code ?? '').trim() && pCode) {
    next.pur_code = pCode;
    next.pur_name = accountDisplayName(purAccounts, pCode);
  }
  if (!String(next.s_code ?? '').trim() && sCode) {
    next.s_code = sCode;
    next.s_name = accountDisplayName(accounts, sCode);
  }
  return next;
}
