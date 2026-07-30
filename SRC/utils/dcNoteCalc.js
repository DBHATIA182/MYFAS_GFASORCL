/** VFP DCNOTE — line amount (AMT_CAL W/Q), GST by L/C, footer MBAMT. */

export function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function asAmt(v) {
  const n = round2(v);
  return n ? String(n) : '';
}

function keepGstPer(raw, seededNum, seeded) {
  if (seeded) {
    const n = num(seededNum);
    return n ? String(n) : '';
  }
  const s = String(raw ?? '');
  if (s === '' || /^\d*\.?\d*$/.test(s)) return s;
  const n = num(s);
  return n ? String(n) : '';
}

function perEmpty(raw) {
  return String(raw ?? '').trim() === '';
}

/** amount = W → weight*rate ; Q → qnty*rate. Taxable = amount. */
export function recalcLine(line, l_c) {
  const lc = String(l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L';
  const amtCal = String(line.amt_cal ?? 'W').trim().toUpperCase().slice(0, 1) || 'W';
  const qnty = num(line.qnty);
  const weight = num(line.weight);
  const rate = num(line.rate);
  const amount = round2(amtCal === 'Q' ? qnty * rate : weight * rate);
  const taxable = amount;

  let cgstPer = num(line.cgst_per);
  let sgstPer = num(line.sgst_per);
  let igstPer = num(line.igst_per);
  const taxPer = num(line.tax_per);
  let seedCgst = false;
  let seedSgst = false;
  let seedIgst = false;

  if (taxPer) {
    if (lc === 'L') {
      if (perEmpty(line.cgst_per) && perEmpty(line.sgst_per)) {
        cgstPer = taxPer / 2;
        sgstPer = taxPer / 2;
        seedCgst = true;
        seedSgst = true;
      }
      igstPer = 0;
    } else if (perEmpty(line.igst_per)) {
      igstPer = taxPer;
      seedIgst = true;
      cgstPer = 0;
      sgstPer = 0;
    }
  }

  if (lc === 'L') {
    return {
      ...line,
      amount: asAmt(amount),
      cgst_per: keepGstPer(line.cgst_per, cgstPer, seedCgst),
      sgst_per: keepGstPer(line.sgst_per, sgstPer, seedSgst),
      igst_per: '',
      cgst_amt: asAmt(round2((taxable * cgstPer) / 100)),
      sgst_amt: asAmt(round2((taxable * sgstPer) / 100)),
      igst_amt: '',
    };
  }

  return {
    ...line,
    amount: asAmt(amount),
    cgst_per: '',
    sgst_per: '',
    igst_per: keepGstPer(line.igst_per, igstPer, seedIgst),
    cgst_amt: '',
    sgst_amt: '',
    igst_amt: asAmt(round2((taxable * igstPer) / 100)),
  };
}

export function sumFooter(lines, footer = {}) {
  const sums = { mamt: 0, tq: 0, tw: 0, cgst_amt: 0, sgst_amt: 0, igst_amt: 0 };
  for (const ln of lines || []) {
    if (!Number(ln.item_code)) continue;
    sums.mamt += num(ln.amount);
    sums.tq += num(ln.qnty);
    sums.tw += num(ln.weight);
    sums.cgst_amt += num(ln.cgst_amt);
    sums.sgst_amt += num(ln.sgst_amt);
    sums.igst_amt += num(ln.igst_amt);
  }
  const addexp = num(footer.addexp);
  const mbamt = round2(sums.mamt + sums.cgst_amt + sums.sgst_amt + sums.igst_amt + addexp);
  return { ...sums, addexp, mbamt };
}

export function accountDisplayName(list, code) {
  const c = String(code ?? '').trim();
  if (!c) return '';
  const hit = (list || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === c);
  return hit ? String(hit.NAME ?? hit.name ?? '').trim() : '';
}

export function applyItemmastToLine(line, itemRow, { purAccounts = [] } = {}) {
  if (!itemRow) return line;
  const next = { ...line };
  next.item_name = String(itemRow.ITEM_NAME ?? itemRow.item_name ?? next.item_name ?? '').trim();
  const taxPer = num(itemRow.TAX_PER ?? itemRow.tax_per);
  if (taxPer) next.tax_per = String(taxPer);
  const amtCal = String(itemRow.AMT_CAL ?? itemRow.amt_cal ?? '').trim().toUpperCase().slice(0, 1);
  if (amtCal === 'Q' || amtCal === 'W') next.amt_cal = amtCal;
  const pCode = String(itemRow.P_CODE ?? itemRow.p_code ?? '').trim().toUpperCase();
  if (!String(next.pur_code ?? '').trim() && pCode) {
    next.pur_code = pCode;
    next.pur_name = accountDisplayName(purAccounts, pCode);
  }
  return next;
}

export function sanitizeGstPerInput(raw) {
  let s = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) s = `${s.slice(0, dot + 1)}${s.slice(dot + 1).replace(/\./g, '')}`;
  return s;
}
