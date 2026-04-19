import { toInputDateString, toDisplayDate } from './dateFormat';

function n(row, upperKey, lowerKey) {
  const v = row[upperKey] ?? row[lowerKey];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

/** Credit note lines: show key measures as negative in list and totals */
export function isSaleListCn(row) {
  return String(row?.TYPE ?? row?.type ?? '').trim().toUpperCase() === 'CN';
}

export function saleListMeas(row, upperKey, lowerKey) {
  const v = n(row, upperKey, lowerKey);
  return isSaleListCn(row) ? -v : v;
}

function dayKey(row) {
  return toInputDateString(row.BILL_DATE ?? row.bill_date) || '_nodate';
}

function itemCode(row) {
  return String(row.ITEM_CODE ?? row.item_code ?? '').trim();
}

function itemName(row) {
  return String(row.ITEM_NAME ?? row.item_name ?? '').trim();
}

function compareLines(a, b) {
  const da = dayKey(a).localeCompare(dayKey(b));
  if (da !== 0) return da;
  const bn = String(a.BILL_NO ?? a.bill_no ?? '').localeCompare(String(b.BILL_NO ?? b.bill_no ?? ''), undefined, {
    numeric: true,
  });
  if (bn !== 0) return bn;
  const bt = String(a.B_TYPE ?? a.b_type ?? '').localeCompare(String(b.B_TYPE ?? b.b_type ?? ''));
  if (bt !== 0) return bt;
  return (parseFloat(a.TRN_NO ?? a.trn_no) || 0) - (parseFloat(b.TRN_NO ?? b.trn_no) || 0);
}

/**
 * Day blocks → day totals → item-wise summary (qty, weight, amount) → **grand total last** (all measure columns).
 *
 * @returns {{ displayRows: Array<{kind:string,...}> }}
 */
export function buildSaleListDisplayRows(data) {
  const raw = [...(data || [])];
  raw.sort(compareLines);

  const byDay = new Map();
  for (const row of raw) {
    const k = dayKey(row);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(row);
  }

  const sortedDays = [...byDay.keys()].filter((k) => k !== '_nodate').sort();
  if (byDay.has('_nodate')) sortedDays.push('_nodate');

  const displayRows = [];
  const grandItemAgg = new Map();

  let grandQ = 0;
  let grandW = 0;
  let grandA = 0;
  let grandTax = 0;
  let grandC = 0;
  let grandS = 0;
  let grandI = 0;
  let grandB = 0;
  let grandDis = 0;
  let grandOth = 0;

  for (const dk of sortedDays) {
    const dayRows = byDay.get(dk) || [];
    const dateLabel = dk === '_nodate' ? '—' : toDisplayDate(dk);

    displayRows.push({ kind: 'day-header', dateKey: dk, dateLabel });

    for (const row of dayRows) {
      displayRows.push({ kind: 'detail', row });
    }

    let dQ = 0;
    let dW = 0;
    let dA = 0;
    let dTax = 0;
    let dCgst = 0;
    let dSgst = 0;
    let dIgst = 0;
    let dB = 0;
    let dDis = 0;
    let dOth = 0;

    for (const row of dayRows) {
      const q = saleListMeas(row, 'QNTY', 'qnty');
      const w = saleListMeas(row, 'WEIGHT', 'weight');
      const a = saleListMeas(row, 'AMOUNT', 'amount');
      const tax = saleListMeas(row, 'TAXABLE', 'taxable');
      const cgst = saleListMeas(row, 'CGST_AMT', 'cgst_amt');
      const sgst = saleListMeas(row, 'SGST_AMT', 'sgst_amt');
      const igst = saleListMeas(row, 'IGST_AMT', 'igst_amt');
      const b = saleListMeas(row, 'BILL_AMT', 'bill_amt');
      const dis = n(row, 'DIS_AMT', 'dis_amt');
      const oth = n(row, 'OTH_EXP5', 'oth_exp5');
      dQ += q;
      dW += w;
      dA += a;
      dTax += tax;
      dCgst += cgst;
      dSgst += sgst;
      dIgst += igst;
      dB += b;
      dDis += dis;
      dOth += oth;

      const ic = itemCode(row) || '—';
      if (!grandItemAgg.has(ic)) {
        grandItemAgg.set(ic, { code: ic, name: itemName(row) || '—', qnty: 0, weight: 0, amount: 0 });
      }
      const g = grandItemAgg.get(ic);
      g.qnty += q;
      g.weight += w;
      g.amount += a;
    }

    grandQ += dQ;
    grandW += dW;
    grandA += dA;
    grandTax += dTax;
    grandC += dCgst;
    grandS += dSgst;
    grandI += dIgst;
    grandB += dB;
    grandDis += dDis;
    grandOth += dOth;

    displayRows.push({
      kind: 'day-total',
      dateLabel,
      qnty: dQ,
      weight: dW,
      amount: dA,
      taxable: dTax,
      cgstAmt: dCgst,
      sgstAmt: dSgst,
      igstAmt: dIgst,
      billAmt: dB,
      disAmt: dDis,
      othExp5: dOth,
    });
  }

  displayRows.push({ kind: 'section-label', label: 'Item-wise summary (full period)' });
  displayRows.push({ kind: 'item-col-head' });

  const grandItems = [...grandItemAgg.values()].sort((x, y) =>
    String(x.code).localeCompare(String(y.code), 'en', { sensitivity: 'base', numeric: true })
  );
  for (const it of grandItems) {
    displayRows.push({ kind: 'grand-item', ...it });
  }

  displayRows.push({
    kind: 'grand-total',
    qnty: grandQ,
    weight: grandW,
    amount: grandA,
    taxable: grandTax,
    cgstAmt: grandC,
    sgstAmt: grandS,
    igstAmt: grandI,
    billAmt: grandB,
    disAmt: grandDis,
    othExp5: grandOth,
  });

  return { displayRows };
}
