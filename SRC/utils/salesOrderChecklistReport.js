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

async function fetchSoCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('SO checklist: company header unavailable', err?.message || err);
    return {};
  }
}

function buildPayload(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const totals = { qnty: 0, weight: 0, amount: 0, dr_amt: 0 };
  const detailRows = list.map((row) => {
    const detail = {
      so_date: fmtDate(row.so_date),
      so_no: Number(row.so_no) || 0,
      delv_date: fmtDate(row.delv_date),
      party_name: String(row.party_name || '').trim(),
      bk_name: String(row.bk_name || '').trim(),
      item_name: String(row.item_name || '').trim(),
      rake_truck: String(row.rake_truck || '').trim(),
      d_e: String(row.d_e || '').trim(),
      god_code: String(row.god_code || '').trim(),
      qnty: num(row.qnty),
      weight: num(row.weight),
      usd_rate: num(row.usd_rate),
      conv_rate: num(row.conv_rate),
      rate: num(row.rate),
      amount: num(row.amount),
      dr_amt: num(row.dr_amt),
    };
    totals.qnty += detail.qnty;
    totals.weight += detail.weight;
    totals.amount += detail.amount;
    totals.dr_amt += detail.dr_amt;
    return detail;
  });
  return {
    filters: {
      sdt: fmtDate(filters.sdt),
      edt: fmtDate(filters.edt),
    },
    rows: detailRows,
    totals,
  };
}

function buildMetadata(payload, company, formData, userName) {
  const stamp = new Date().toISOString().split('T')[0];
  const companyName = company.companyName || formData?.comp_name || formData?.COMP_NAME || '';
  return {
    companyName,
    company,
    reportTitle: 'SALES ORDER CHECKLIST',
    documentTitle: 'SALES ORDER CHECKLIST',
    period: `FROM ${payload.filters.sdt || '—'} TO ${payload.filters.edt || '—'}`,
    preparedBy: userName || '',
    combinedFilename: `${String(companyName || 'Company').replace(/\s+/g, '_')}_SalesOrderChecklist_${stamp}.pdf`,
  };
}

function buildHtml(payload, metadata) {
  const rows = payload.rows
    .map(
      (r) => `<tr>
        <td>${esc(r.so_date)}</td><td class="num">${esc(r.so_no)}</td><td>${esc(r.delv_date)}</td>
        <td>${esc(r.party_name)}</td><td>${esc(r.bk_name)}</td><td>${esc(r.item_name)}</td>
        <td>${esc(r.rake_truck)}</td><td>${esc(r.d_e)}</td><td>${esc(r.god_code)}</td>
        <td class="num">${fmt(r.qnty, 0)}</td><td class="num">${fmt(r.weight, 3)}</td>
        <td class="num">${fmt(r.usd_rate)}</td><td class="num">${fmt(r.conv_rate)}</td>
        <td class="num">${fmt(r.rate)}</td><td class="num">${fmt(r.amount)}</td>
        <td class="num">${fmt(r.dr_amt)}</td>
      </tr>`
    )
    .join('');
  const t = payload.totals;
  return `<div class="report-doc so-checklist">
    <style>
      * { box-sizing: border-box; }
      .so-checklist { font-family: Arial, sans-serif; color: #111; border: 1px solid #bbb; padding: 10px 12px; }
      .so-checklist__head { text-align: center; margin-bottom: 9px; }
      .so-checklist__company { font-size: 15px; font-weight: 700; text-transform: uppercase; }
      .so-checklist__title { font-size: 16px; font-weight: 700; margin-top: 2px; }
      .so-checklist__period { font-size: 9px; margin-top: 3px; }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 6.8px; }
      th, td { border: 1px solid #ccc; padding: 2px; line-height: 1.1; vertical-align: top; word-break: break-word; }
      th { background: #eee; text-align: left; }
      .num { text-align: right; white-space: nowrap; }
      tfoot td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
    </style>
    <div class="so-checklist__head">
      <div class="so-checklist__company">${esc(metadata.companyName)}</div>
      <div class="so-checklist__title">SALES ORDER CHECKLIST</div>
      <div class="so-checklist__period">${esc(metadata.period)}</div>
    </div>
    <table>
      <thead><tr>
        <th>Date</th><th class="num">No.</th><th>Delv.Date</th><th>Party Name</th><th>Broker</th>
        <th>Item Name</th><th>R/T</th><th>D/E</th><th>God.</th><th class="num">Qty.</th>
        <th class="num">Weight</th><th class="num">USD Rate</th><th class="num">Conv.Rate</th>
        <th class="num">Rate</th><th class="num">Amount</th><th class="num">Adv.Amount</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="16">(No rows)</td></tr>'}</tbody>
      <tfoot><tr>
        <td colspan="9">GRAND TOTAL</td><td class="num">${fmt(t.qnty, 0)}</td>
        <td class="num">${fmt(t.weight, 3)}</td><td colspan="3"></td>
        <td class="num">${fmt(t.amount)}</td><td class="num">${fmt(t.dr_amt)}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

async function buildReport(apiBase, ctx) {
  const payload = buildPayload(ctx.rows, ctx.filters);
  const company = await fetchSoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildMetadata(payload, company, ctx.formData, ctx.userName);
  return { payload, metadata, html: buildHtml(payload, metadata) };
}

export function downloadSalesOrderChecklistExcel(rows, formData) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error('No rows to export.');
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
  downloadExcelRows(
    list.map((row) => ({
      Date: fmtDate(row.so_date),
      'No.': Number(row.so_no) || 0,
      'Delv.Date': fmtDate(row.delv_date),
      'Party Name': String(row.party_name || '').trim(),
      Broker: String(row.bk_name || '').trim(),
      'Item Name': String(row.item_name || '').trim(),
      'R/T': String(row.rake_truck || '').trim(),
      'D/E': String(row.d_e || '').trim(),
      'God.': String(row.god_code || '').trim(),
      'Qty.': num(row.qnty),
      Weight: num(row.weight),
      'USD Rate': num(row.usd_rate),
      'Conv.Rate': num(row.conv_rate),
      Rate: num(row.rate),
      Amount: num(row.amount),
      'Adv.Amount': num(row.dr_amt),
    })),
    'SalesOrderChecklist',
    `${compName}_SalesOrderChecklist`
  );
}

export async function exportSalesOrderChecklistPdf(apiBase, ctx) {
  const { html, metadata } = await buildReport(apiBase, ctx);
  await downloadCombinedReportPdf('purchase-order-checklist', [html], metadata);
}

export async function printSalesOrderChecklist(apiBase, ctx) {
  const { html, metadata } = await buildReport(apiBase, ctx);
  const { blob } = await getCombinedReportPdfBlob('purchase-order-checklist', [html], metadata);
  await printPdfBlob(blob);
}

export async function shareSalesOrderChecklistWhatsApp(apiBase, ctx) {
  const { payload, html, metadata } = await buildReport(apiBase, ctx);
  const { blob, filename } = await getCombinedReportPdfBlob('purchase-order-checklist', [html], metadata);
  const shareText = `${metadata.companyName}\nSALES ORDER CHECKLIST\n${metadata.period}`;
  await sharePdfWithWhatsApp('purchase-order-checklist', payload, metadata, shareText, {
    prebuiltBlob: blob,
    prebuiltFilename: filename,
  });
}
