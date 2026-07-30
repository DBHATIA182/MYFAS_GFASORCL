/** VFP EXPVOU — line amount, GST split (L/C), footer totals (MBAMT / NET_PAYABLE). */

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

/** Keep user-typed GST % (incl. "2." / "2.5") — only replace when seeding from TAX_PER. */
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

/**
 * amount = round(weight * rate, 2)
 * L: CGST/SGST from tax_per (split) or line cgst_per; taxable = amount + freight
 * C: IGST only
 */
export function recalcLine(line, l_c) {
  const lc = String(l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L';
  const weight = num(line.weight);
  const rate = num(line.rate);
  const amount = round2(weight * rate);
  const freight = num(line.freight);
  const taxable = amount + freight;

  let cgstPer = num(line.cgst_per);
  let sgstPer = num(line.sgst_per);
  let igstPer = num(line.igst_per);
  const taxPer = num(line.tax_per);
  let seedCgst = false;
  let seedSgst = false;
  let seedIgst = false;

  // Seed GST % from item TAX_PER only when line percents are still empty.
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
    const cgstAmt = round2((taxable * cgstPer) / 100);
    const sgstAmt = round2((taxable * sgstPer) / 100);
    return {
      ...line,
      amount: asAmt(amount),
      cgst_per: keepGstPer(line.cgst_per, cgstPer, seedCgst),
      sgst_per: keepGstPer(line.sgst_per, sgstPer, seedSgst),
      igst_per: '',
      cgst_amt: asAmt(cgstAmt),
      sgst_amt: asAmt(sgstAmt),
      igst_amt: '',
    };
  }

  const igstAmt = round2((taxable * igstPer) / 100);
  return {
    ...line,
    amount: asAmt(amount),
    cgst_per: '',
    sgst_per: '',
    igst_per: keepGstPer(line.igst_per, igstPer, seedIgst),
    cgst_amt: '',
    sgst_amt: '',
    igst_amt: asAmt(igstAmt),
  };
}

/** Sum grid + footer — MBAMT and net payable (VFP: +TCS, −NTDS). */
export function sumFooter(lines, footer = {}) {
  const sums = {
    mamt: 0,
    tw: 0,
    freight: 0,
    cgst_amt: 0,
    sgst_amt: 0,
    igst_amt: 0,
  };
  for (const ln of lines || []) {
    if (!Number(ln.item_code)) continue;
    sums.mamt += num(ln.amount);
    sums.tw += num(ln.weight);
    sums.freight += num(ln.freight);
    sums.cgst_amt += num(ln.cgst_amt);
    sums.sgst_amt += num(ln.sgst_amt);
    sums.igst_amt += num(ln.igst_amt);
  }

  const oth1 = num(footer.oth_exp_1);
  const tcs = num(footer.tcs_amt);
  const ntds = num(footer.ntds_amt);
  const mbamt = round2(
    sums.mamt + sums.cgst_amt + sums.sgst_amt + sums.igst_amt + sums.freight + oth1 + tcs
  );
  const net_payable = round2(mbamt - ntds);

  return { ...sums, mbamt, net_payable };
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
  const pCode = String(itemRow.P_CODE ?? itemRow.p_code ?? '').trim().toUpperCase();
  if (!String(next.pur_code ?? '').trim() && pCode) {
    next.pur_code = pCode;
    next.pur_name = accountDisplayName(purAccounts, pCode);
  }
  return next;
}

/** Allow digits + one decimal point while typing GST %. */
export function sanitizeGstPerInput(raw) {
  let s = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot >= 0) {
    s = `${s.slice(0, dot + 1)}${s.slice(dot + 1).replace(/\./g, '')}`;
  }
  return s;
}
