import axios from 'axios';
import { formatLedgerDateDisplay } from './dateFormat';
import {
  buildReportHtml,
  generatePDF,
  sharePdfWithWhatsApp,
  downloadCombinedReportPdf,
  getCombinedReportPdfBlob,
} from './pdfgenerator';
import { printHtmlDocument } from './openPrintPreviewWindow';
import { signedQrCodeToDataUrl } from './qrDataUrl';
import { rowFieldCI } from './rowFieldCI';

function n(row, upper, lower) {
  const x = row?.[upper] ?? row?.[lower];
  if (x == null || x === '') return 0;
  const p = parseFloat(x);
  return Number.isNaN(p) ? 0 : p;
}

function signedQrRaw(row) {
  if (!row) return null;
  const ci = rowFieldCI(row, 'signed_qr_code');
  if (ci) return ci;
  for (const k of Object.keys(row)) {
    const kl = k.toLowerCase();
    if (kl.includes('hsn')) continue;
    if (
      (kl.includes('signed') && kl.includes('qr')) ||
      (kl.includes('einvoice') && kl.includes('qr')) ||
      (kl.includes('qr') && (kl.includes('code') || kl.includes('image') || kl.includes('sign')))
    ) {
      const val = row[k];
      if (val == null || val === '') continue;
      if (typeof val === 'object' && val.type === 'Buffer' && Array.isArray(val.data)) return val;
      if (String(val).trim() !== '') return val;
    }
  }
  return null;
}

function safeFilenamePart(name) {
  return String(name || 'Company').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
}

const BULK_FETCH_CONCURRENCY = 4;
const BULK_FETCH_TIMEOUT_MS = 90000;

async function fetchOneBillPayload(apiBase, compCode, compUid, header, billParams, companyName, reqOpts) {
  const lRes = await axios.get(`${apiBase}/api/sale-bill-print`, {
    params: buildSaleBillLinesApiParams(billParams, compCode, compUid),
    ...reqOpts,
  });
  const lines = Array.isArray(lRes.data) ? lRes.data : [];
  if (!lines.length) {
    throw new Error(`No lines for bill ${billParams.billNo ?? '?'}.`);
  }
  return buildSaleBillPayload(header, lines, billParams, { apiBase, companyName });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const runWorker = async () => {
    while (nextIdx < items.length) {
      const i = nextIdx;
      nextIdx += 1;
      results[i] = await worker(items[i], i);
    }
  };
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
}

export function buildSaleBillLinesApiParams(billParams, compCode, compUid) {
  return {
    comp_code: compCode,
    comp_uid: compUid,
    type: billParams.type,
    bill_no: billParams.billNo,
    b_type: billParams.bType,
    bill_date: billParams.oracleDt,
  };
}

function computeSaleBillTotals(lines, first) {
  let sumAmt = 0;
  let sumTax = 0;
  let sumC = 0;
  let sumS = 0;
  let sumI = 0;
  for (const r of lines) {
    sumAmt += n(r, 'AMOUNT', 'amount');
    sumTax += n(r, 'TAXABLE', 'taxable');
    sumC += n(r, 'CGST_AMT', 'cgst_amt');
    sumS += n(r, 'SGST_AMT', 'sgst_amt');
    sumI += n(r, 'IGST_AMT', 'igst_amt');
  }
  const freight = first ? n(first, 'FREIGHT', 'freight') : 0;
  const billAmt = first ? n(first, 'BILL_AMT', 'bill_amt') : 0;
  let disAmt = 0;
  let othExp5 = 0;
  for (const r of lines) {
    disAmt += n(r, 'DIS_AMT', 'dis_amt');
    othExp5 += n(r, 'OTH_EXP5', 'oth_exp5');
  }
  return { sumAmt, sumTax, sumC, sumS, sumI, freight, billAmt, disAmt, othExp5 };
}

function resolveDocTitle(billParams, first, totals) {
  const saleTypeFromBillParams = String(billParams?.type ?? '').trim().toUpperCase();
  const saleTypeFromFirstLine = String(rowFieldCI(first, 'type') || first?.TYPE || first?.type || '')
    .trim()
    .toUpperCase();
  const isCreditNoteSale = saleTypeFromBillParams === 'CN' || saleTypeFromFirstLine === 'CN';
  if (isCreditNoteSale) return 'CREDIT NOTE';
  if (totals.sumC + totals.sumS + totals.sumI === 0) return 'BILL OF SUPPLY';
  return 'TAX INVOICE';
}

function buildSaleBillPayload(header, lines, billParams, { apiBase, companyName }) {
  const first = lines[0];
  const totals = computeSaleBillTotals(lines, first);
  const docTitle = resolveDocTitle(billParams, first, totals);
  const qrSourceRow = lines.find((r) => signedQrRaw(r)) ?? first;
  const qrDataUrl = signedQrCodeToDataUrl(signedQrRaw(qrSourceRow));
  const compDisplayName =
    rowFieldCI(header || {}, 'comp_name') || String(companyName || '').trim() || 'Company';
  const isCreditNoteSale =
    String(billParams?.type ?? '').trim().toUpperCase() === 'CN' ||
    String(rowFieldCI(first, 'type') || first?.TYPE || first?.type || '')
      .trim()
      .toUpperCase() === 'CN';
  const pdfData = { lines, header, first, docTitle, totals, qrDataUrl };
  const pdfMeta = {
    companyName: compDisplayName,
    apiBase,
    printGrossDane: billParams?.printGrossDane,
    printPacking: billParams?.printPacking,
    invoiceNo: isCreditNoteSale
      ? rowFieldCI(first, 'bill_no') || rowFieldCI(first, 'sale_inv_no') || 'bill'
      : rowFieldCI(first, 'sale_inv_no') || rowFieldCI(first, 'bill_no') || 'bill',
  };
  return { pdfData, pdfMeta, label: billParams?.label || pdfMeta.invoiceNo };
}

export async function fetchSaleBillBulkPayloads({
  apiBase,
  compCode,
  compUid,
  companyName,
  billParamsList,
  onProgress,
}) {
  if (!billParamsList?.length) return [];
  const reqOpts = { withCredentials: true, timeout: BULK_FETCH_TIMEOUT_MS };
  const hRes = await axios.get(`${apiBase}/api/compdet-print-header`, {
    params: { comp_code: compCode, comp_uid: compUid },
    ...reqOpts,
  });
  const header = hRes.data || null;
  const total = billParamsList.length;
  let done = 0;
  return mapWithConcurrency(billParamsList, BULK_FETCH_CONCURRENCY, async (billParams) => {
    const payload = await fetchOneBillPayload(apiBase, compCode, compUid, header, billParams, companyName, reqOpts);
    done += 1;
    onProgress?.(done, total);
    return payload;
  });
}

function buildCombinedPrintDocument(payloads) {
  const parts = payloads.map((p, i) => {
    const html = buildReportHtml('sale-bill', p.pdfData, p.pdfMeta);
    return i === 0 ? html : `<div class="sbp-bulk-print-page" style="page-break-before:always;">${html}</div>`;
  });
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Sale bills</title>
    <style>
      @media print {
        .sbp-bulk-print-page { page-break-before: always; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#fff;">${parts.join('')}</body>
</html>`;
}

function buildHtmlFragments(payloads) {
  return payloads.map((p) => buildReportHtml('sale-bill', p.pdfData, p.pdfMeta));
}

function combinedPdfMetadata(companyName, count) {
  return {
    companyName,
    combinedFilename: `${safeFilenamePart(companyName)}_SaleBills_${count}.pdf`,
  };
}

export async function bulkPrintSelectedSaleBills(payloads, { companyName = 'Company' } = {}) {
  if (!payloads.length) return;
  printHtmlDocument(buildCombinedPrintDocument(payloads), {
    title: `${companyName} — ${payloads.length} sale bill(s)`,
    preferNewWindow: true,
  });
}

export async function bulkPdfSelectedSaleBills(payloads, { mode = 'single', companyName = 'Company', onProgress } = {}) {
  if (!payloads.length) return;
  if (mode === 'separate') {
    for (let i = 0; i < payloads.length; i++) {
      onProgress?.(i + 1, payloads.length);
      await generatePDF('sale-bill', payloads[i].pdfData, payloads[i].pdfMeta);
    }
    return;
  }
  await downloadCombinedReportPdf('sale-bill', buildHtmlFragments(payloads), {
    ...combinedPdfMetadata(companyName, payloads.length),
    onProgress,
  });
}

function buildBulkWhatsAppText(payloads, companyName) {
  const labels = payloads.map((p) => p.label).filter(Boolean);
  const head = `${payloads.length} sale bill(s)`;
  const list = labels.slice(0, 8).join('\n');
  const more = labels.length > 8 ? `\n… +${labels.length - 8} more` : '';
  return [head, companyName, list + more].filter(Boolean).join('\n');
}

export async function bulkWhatsAppSelectedSaleBills(
  payloads,
  { mode = 'single', companyName = 'Company', onProgress } = {}
) {
  if (!payloads.length) return;
  const shareText = buildBulkWhatsAppText(payloads, companyName);

  if (mode === 'separate') {
    for (let i = 0; i < payloads.length; i++) {
      const p = payloads[i];
      const refNo = p.pdfMeta.invoiceNo || p.label || `Bill ${i + 1}`;
      const oneText = [`Sale bill — ${refNo}`, companyName, formatLedgerDateDisplay(p.pdfData.first?.BILL_DATE ?? p.pdfData.first?.bill_date)].join('\n');
      if (i > 0) {
        const ok = window.confirm(`Share bill ${i + 1} of ${payloads.length} on WhatsApp?\n${refNo}`);
        if (!ok) continue;
      }
      await sharePdfWithWhatsApp('sale-bill', p.pdfData, p.pdfMeta, oneText);
    }
    return;
  }

  const ok = window.confirm(`Share ${payloads.length} bill(s) as one PDF on WhatsApp?`);
  if (!ok) return;

  const firstPayload = payloads[0];
  const { blob, filename } = await getCombinedReportPdfBlob('sale-bill', buildHtmlFragments(payloads), {
    ...combinedPdfMetadata(companyName, payloads.length),
    onProgress,
  });
  await sharePdfWithWhatsApp('sale-bill', firstPayload.pdfData, firstPayload.pdfMeta, shareText, {
    prebuiltBlob: blob,
    prebuiltFilename: filename,
  });
}
