import axios from 'axios';
import { toDisplayDate } from './dateFormat';
import { downloadExcelRows } from './excelExport';
import {
  downloadCombinedReportPdf,
  getCombinedReportPdfBlob,
  printPdfBlob,
  sharePdfWithWhatsApp,
} from './pdfgenerator';
import { mapCompdetPrintHeader } from './voucherPrint';

const reqOpts = { withCredentials: true, timeout: 120000 };

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v) {
  return toDisplayDate(v) || String(v || '').trim();
}

function fmt(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeBatch(data) {
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  return {
    orders: orders.map((order) => {
      const h = order?.header || {};
      const lines = (Array.isArray(order?.lines) ? order.lines : []).map((ln, idx) => ({
        ...ln,
        sno: idx + 1,
        item_name: String(ln.item_name || '').trim(),
        hsn_code: String(ln.hsn_code || '').trim(),
        status_unit: String(ln.status_unit || '').trim(),
        qnty: num(ln.qnty),
        weight: num(ln.weight),
        usd_rate: num(ln.usd_rate),
        conv_rate: num(ln.conv_rate),
        usd_amount: num(ln.usd_amount),
        rate: num(ln.rate),
        amount: num(ln.amount),
      }));
      const calculated = lines.reduce(
        (t, ln) => ({
          qnty: t.qnty + ln.qnty,
          weight: t.weight + ln.weight,
          usd_amount: t.usd_amount + ln.usd_amount,
          amount: t.amount + ln.amount,
        }),
        { qnty: 0, weight: 0, usd_amount: 0, amount: 0 }
      );
      return {
        header: {
          ...h,
          so_date: fmtDate(h.so_date),
          delv_date: fmtDate(h.delv_date),
          pmt_due_date: fmtDate(h.pmt_due_date),
          d_e: String(h.d_e || 'D').trim().toUpperCase() === 'E' ? 'E' : 'D',
        },
        lines,
        totals: {
          qnty: num(order?.totals?.qnty ?? calculated.qnty),
          weight: num(order?.totals?.weight ?? calculated.weight),
          usd_amount: num(order?.totals?.usd_amount ?? calculated.usd_amount),
          amount: num(order?.totals?.amount ?? calculated.amount),
        },
      };
    }),
  };
}

function payloadFromContext(ctx) {
  if (!ctx?.header) return { orders: [] };
  return normalizeBatch({
    orders: [{ header: ctx.header, lines: ctx.lines || [], totals: ctx.totals || {} }],
  });
}

async function fetchSoCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    let company = mapCompdetPrintHeader(headerRes.data);
    try {
      const fullRes = await axios.get(`${apiBase}/api/compdet-print-header`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
        timeout: 15000,
      });
      company = { ...company, ...mapCompdetPrintHeader(fullRes.data) };
    } catch {
      /* optional richer header */
    }
    return company;
  } catch (err) {
    console.warn('SO print: company header unavailable', err?.message || err);
    return {};
  }
}

function buildMetadata(payload, company, formData, userName) {
  const first = payload?.orders?.[0]?.header || {};
  const stamp = new Date().toISOString().split('T')[0];
  const companyName = company.companyName || formData?.comp_name || formData?.COMP_NAME || '';
  return {
    companyName,
    company,
    documentTitle: 'SALES ORDER',
    soNo: first.so_no,
    soDate: first.so_date,
    preparedBy: userName || '',
    autoOpen: false,
    partyTel: first.tel_no || '',
    combinedFilename: `${String(companyName || 'Company').replace(/\s+/g, '_')}_SalesOrder_${first.so_no || 'Print'}_${stamp}.pdf`,
  };
}

function detailLine(label, value, renderedValue = null) {
  if (value == null || String(value).trim() === '' || (typeof value === 'number' && value === 0)) return '';
  return `<div><strong>${esc(label)}:</strong> ${renderedValue == null ? esc(value) : renderedValue}</div>`;
}

function buildLinesTable(order) {
  const isExport = order.header.d_e === 'E';
  const body = order.lines
    .map((ln, idx) => {
      const qty = `${fmt(ln.qnty, 0)}${ln.status_unit ? ` ${esc(ln.status_unit)}` : ''}`;
      if (isExport) {
        return `<tr>
          <td class="num">${idx + 1}</td><td>${esc(ln.item_name)}</td><td>${esc(ln.hsn_code)}</td>
          <td class="num">${qty}</td><td class="num">${fmt(ln.weight, 3)}</td>
          <td class="num">${fmt(ln.usd_rate)}</td><td class="num">${fmt(ln.usd_amount)}</td>
          <td class="num">${fmt(ln.conv_rate)}</td><td class="num">${fmt(ln.rate)}</td>
          <td class="num">${fmt(ln.amount)}</td>
        </tr>`;
      }
      return `<tr>
        <td class="num">${idx + 1}</td><td>${esc(ln.item_name)}</td><td>${esc(ln.hsn_code)}</td>
        <td class="num">${qty}</td><td class="num">${fmt(ln.weight, 3)}</td>
        <td class="num">${fmt(ln.rate)}</td><td class="num">${fmt(ln.amount)}</td>
      </tr>`;
    })
    .join('');
  const t = order.totals;
  if (isExport) {
    return `<table class="so-print-table">
      <thead><tr><th>#</th><th>Particulars</th><th>HsnCode</th><th class="num">Qty.</th>
        <th class="num">Weight</th><th class="num">USD Rate</th><th class="num">USD Amount</th>
        <th class="num">Conv.Rate</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="3"><strong>TOTAL</strong></td><td class="num"><strong>${fmt(t.qnty, 0)}</strong></td>
        <td class="num"><strong>${fmt(t.weight, 3)}</strong></td><td></td>
        <td class="num"><strong>${fmt(t.usd_amount)}</strong></td><td colspan="2"></td>
        <td class="num"><strong>${fmt(t.amount)}</strong></td></tr></tfoot>
    </table>`;
  }
  return `<table class="so-print-table">
    <thead><tr><th>#</th><th>Particulars</th><th>HsnCode</th><th class="num">Qty.</th>
      <th class="num">Weight</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td colspan="3"><strong>TOTAL</strong></td><td class="num"><strong>${fmt(t.qnty, 0)}</strong></td>
      <td class="num"><strong>${fmt(t.weight, 3)}</strong></td><td></td>
      <td class="num"><strong>${fmt(t.amount)}</strong></td></tr></tfoot>
  </table>`;
}

function buildOrderHtml(order, company, metadata) {
  const h = order.header;
  const phLine = [company.tel1, company.tel2].filter(Boolean).join(', ');
  const partyAddress = [h.add1, h.add2, h.add3, h.city].filter((v) => String(v || '').trim());
  const gstRows = [
    ['Cgst', h.cgst_per, h.cgst_amt],
    ['Sgst', h.sgst_per, h.sgst_amt],
    ['Igst', h.igst_per, h.igst_amt],
  ]
    .filter(([, per, amount]) => num(per) || num(amount))
    .map(([label, per, amount]) => `<tr><td>${label} %</td><td class="num">${fmt(per)}</td><td class="num">${fmt(amount)}</td></tr>`)
    .join('');
  return `<section class="so-print-copy">
    <table class="so-print-top"><tbody><tr>
      <td class="so-print-top__side">
        ${detailLine('GSTIN', company.gst)}${detailLine('EMAIL', company.email)}${detailLine('PAN', company.pan)}
      </td>
      <td class="so-print-top__title">SALES ORDER</td>
      <td class="so-print-top__side so-print-top__side--right">
        ${detailLine('PH', phLine)}${detailLine('FAX', company.tel3)}${detailLine('CIN', company.cin)}
      </td>
    </tr></tbody></table>
    <div class="so-print-company">
      <div class="so-print-company__name">${esc(company.companyName || metadata.companyName)}</div>
      ${company.add1 ? `<div>${esc(company.add1)}</div>` : ''}
      ${company.add2 ? `<div>${esc(company.add2)}</div>` : ''}
    </div>
    <div class="so-print-party-row">
      <div class="so-print-party">
        <div>M/s <strong>${esc(h.party_name)}</strong></div>
        ${partyAddress.map((line) => `<div>${esc(line)}</div>`).join('')}
      </div>
      <table class="so-print-meta"><tbody>
        <tr><td class="label">Order No.</td><td>${esc(h.so_no)}</td></tr>
        <tr><td class="label">Dated</td><td>${esc(h.so_date)}</td></tr>
        <tr><td class="label">Delv Due Date</td><td>${esc(h.delv_date)}</td></tr>
        <tr><td class="label">Pmt Due Date</td><td>${esc(h.pmt_due_date)}</td></tr>
      </tbody></table>
    </div>
    <div class="so-print-contact">
      <span>Tel: ${esc(h.tel_no || '—')}</span><span>GSTIN: ${esc(h.gst_no || '—')}</span>
      <span>Broker: ${esc(h.bk_name || '—')}</span>
    </div>
    ${buildLinesTable(order)}
    <div class="so-print-bottom">
      <div class="so-print-terms">
        ${detailLine('P.O.No.', h.po_no)}
        ${detailLine('Payment Conditions', h.p_condition)}
        ${detailLine('Delivery Month', h.delv_mth)}
        ${detailLine('Rake/Truck', h.rake_truck)}
        ${detailLine('Delivery Station', h.delv_city)}
        ${detailLine('Fgt.Rate', num(h.fgt_rate), fmt(h.fgt_rate))}
        ${detailLine('Remarks', h.remarks)}
        ${detailLine('Remarks', h.remarks2)}
        ${detailLine('Remarks', h.remarks3)}
      </div>
      <table class="so-print-gst"><tbody>
        ${gstRows}
        ${num(h.bill_amt) ? `<tr class="bill"><td colspan="2">Bill Amount</td><td class="num">${fmt(h.bill_amt)}</td></tr>` : ''}
      </tbody></table>
    </div>
    <div class="so-print-sign">For ${esc(company.companyName || metadata.companyName)}</div>
  </section>`;
}

function buildHtml(payload, metadata) {
  const company = metadata.company || {};
  const orders = Array.isArray(payload?.orders) ? payload.orders : [];
  return `<div class="so-print report-doc">
    <style>
      * { box-sizing: border-box; }
      .so-print { font-family: Arial, sans-serif; font-size: 9px; color: #111; }
      .so-print-copy { page-break-after: always; padding: 2px; }
      .so-print-copy:last-child { page-break-after: auto; }
      .so-print-top { width: 100%; border-collapse: collapse; margin-bottom: 3px; }
      .so-print-top td { border: 0; vertical-align: top; padding: 0 2px; line-height: 1.25; }
      .so-print-top__side { width: 32%; font-size: 8.5px; }
      .so-print-top__side--right { text-align: right; }
      .so-print-top__title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: .5px; }
      .so-print-company { text-align: center; line-height: 1.3; margin: 2px 0 7px; }
      .so-print-company__name { font-size: 16px; font-weight: 700; }
      .so-print-party-row { display: flex; gap: 10px; align-items: flex-start; }
      .so-print-party { flex: 1; line-height: 1.35; }
      .so-print-meta { width: 200px; border-collapse: collapse; }
      .so-print-meta td { border: 1px solid #888; padding: 2px 5px; }
      .so-print-meta .label { width: 52%; font-weight: 600; background: #eee; }
      .so-print-contact { display: flex; gap: 24px; margin: 5px 0; padding: 3px 4px; border: 1px solid #aaa; }
      .so-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5px; }
      .so-print-table th, .so-print-table td { border: 1px solid #888; padding: 3px; vertical-align: top; }
      .so-print-table th { background: #ddd; }
      .num { text-align: right; white-space: nowrap; }
      .so-print-bottom { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; line-height: 1.45; }
      .so-print-terms { flex: 1; }
      .so-print-gst { width: 235px; border-collapse: collapse; }
      .so-print-gst td { border: 1px solid #999; padding: 2px 4px; }
      .so-print-gst .bill td { font-weight: 700; border-top: 2px solid #555; }
      .so-print-sign { margin-top: 28px; text-align: right; font-weight: 600; }
    </style>
    ${orders.map((order) => buildOrderHtml(order, company, metadata)).join('') || '<div>No sales orders to print.</div>'}
  </div>`;
}

export async function fetchSalesOrderPrintBatch(apiBase, apiParams, { sbno, ebno, dE } = {}) {
  const params = {
    ...apiParams,
    sbno: sbno || 1,
    ebno: ebno || sbno || 1,
  };
  const de = String(dE || '').trim().toUpperCase();
  if (de === 'D' || de === 'E') params.d_e = de;
  const { data } = await axios.get(`${apiBase == null ? '' : String(apiBase)}/api/sales-order/print-batch`, {
    params,
    ...reqOpts,
  });
  return normalizeBatch(data);
}

export async function buildSalesOrderPrintContext(apiBase, ctx, payload) {
  const normalized = normalizeBatch(payload);
  const company = await fetchSoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildMetadata(normalized, company, ctx.formData, ctx.userName);
  return { payload: normalized, metadata, company };
}

export function buildSalesOrderPrintPreviewHtml(payload, metadata) {
  return buildHtml(normalizeBatch(payload), metadata);
}

export function downloadSalesOrderPrintExcel(batchPayload, formData) {
  const orders = normalizeBatch(batchPayload).orders;
  const rows = [];
  for (const order of orders) {
    const h = order.header;
    for (const ln of order.lines) {
      rows.push({
        'Order No.': h.so_no,
        Dated: h.so_date,
        'Delv Due Date': h.delv_date,
        'Pmt Due Date': h.pmt_due_date,
        'D/E': h.d_e,
        Party: h.party_name,
        Broker: h.bk_name,
        Particulars: ln.item_name,
        HsnCode: ln.hsn_code,
        Qty: ln.status_unit ? `${ln.qnty} ${ln.status_unit}` : ln.qnty,
        Weight: ln.weight,
        'USD Rate': h.d_e === 'E' ? ln.usd_rate : '',
        'USD Amount': h.d_e === 'E' ? ln.usd_amount : '',
        'Conv.Rate': h.d_e === 'E' ? ln.conv_rate : '',
        Rate: ln.rate,
        Amount: ln.amount,
      });
    }
  }
  if (!rows.length) throw new Error('No rows to export.');
  const comp = formData?.comp_name || formData?.COMP_NAME || 'Company';
  downloadExcelRows(rows, 'SalesOrderPrint', `${comp}_Sales_Order_Print`.replace(/\s+/g, '_'));
}

export async function exportSalesOrderPdf(apiBase, ctx, payloadOverride = null) {
  const payload = payloadOverride || payloadFromContext(ctx);
  const { payload: normalized, metadata } = await buildSalesOrderPrintContext(apiBase, ctx, payload);
  await downloadCombinedReportPdf('purchase-order-print', [buildHtml(normalized, metadata)], metadata);
}

export async function printSalesOrderBrowser(apiBase, ctx, payloadOverride = null) {
  const payload = payloadOverride || payloadFromContext(ctx);
  const { payload: normalized, metadata } = await buildSalesOrderPrintContext(apiBase, ctx, payload);
  const { blob } = await getCombinedReportPdfBlob('purchase-order-print', [buildHtml(normalized, metadata)], metadata);
  await printPdfBlob(blob);
}

export async function shareSalesOrderWhatsApp(apiBase, ctx, payloadOverride = null) {
  const payload = payloadOverride || payloadFromContext(ctx);
  const { payload: normalized, metadata } = await buildSalesOrderPrintContext(apiBase, ctx, payload);
  const { blob, filename } = await getCombinedReportPdfBlob(
    'purchase-order-print',
    [buildHtml(normalized, metadata)],
    metadata
  );
  const shareText = `${metadata.companyName} — Sales Order No. ${metadata.soNo} dated ${metadata.soDate}`;
  await sharePdfWithWhatsApp('purchase-order-print', normalized, metadata, shareText, {
    prebuiltBlob: blob,
    prebuiltFilename: filename,
  });
}
