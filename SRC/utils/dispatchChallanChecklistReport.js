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

async function fetchCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('DC checklist: company header unavailable', err?.message || err);
    return {};
  }
}

export function buildDispatchChallanChecklistPayload(rows, filters = {}, headName = '') {
  const list = Array.isArray(rows) ? rows : [];
  const totals = { qnty: 0, bags: 0, katta: 0, hkatta: 0, weight: 0, amount: 0 };
  const detailRows = list.map((row) => {
    const status = String(row.status || 'B').trim().toUpperCase() || 'B';
    const qnty = num(row.qnty);
    const bags = num(row.bags) || (status === 'B' ? qnty : 0);
    const katta = num(row.katta) || (status === 'K' ? qnty : 0);
    const hkatta = num(row.hkatta) || (status === 'H' ? qnty : 0);
    const weight = num(row.weight);
    const amount = num(row.amount);
    totals.qnty += qnty;
    totals.bags += bags;
    totals.katta += katta;
    totals.hkatta += hkatta;
    totals.weight += weight;
    totals.amount += amount;
    return {
      bill_date: fmtDate(row.bill_date),
      bill_no: Number(row.bill_no) || 0,
      b_type: String(row.b_type || 'N').trim() || 'N',
      code: String(row.code || '').trim(),
      party_name: String(row.party_name || '').trim(),
      city: String(row.city || '').trim(),
      l_c: String(row.l_c || '').trim(),
      bk_name: String(row.bk_name || '').trim(),
      sup_code: String(row.sup_code || '').trim(),
      sup_name: String(row.sup_name || '').trim(),
      item_code: Number(row.item_code) || 0,
      item_name: String(row.item_name || '').trim(),
      status,
      lot: String(row.lot || '').trim(),
      god_code: String(row.god_code || '').trim(),
      packing: num(row.packing),
      qnty,
      bags,
      katta,
      hkatta,
      weight,
      rate: num(row.rate),
      amount,
      truck_no: String(row.truck_no || '').trim(),
      marka: String(row.marka || '').trim(),
    };
  });
  const sdt = fmtDate(filters.sdt);
  const edt = fmtDate(filters.edt);
  return {
    head_name:
      headName ||
      `DISPATCH CHALLAN LIST FROM ${sdt || '—'} TO ${edt || '—'}`,
    filters: {
      sdt,
      edt,
      sbno: Number(filters.sbno) || 0,
      ebno: Number(filters.ebno) || 999999,
      code: String(filters.code || '').trim(),
      item_code: Number(filters.item_code) || 0,
      sup_code: String(filters.sup_code || '').trim(),
      bk_code: String(filters.bk_code || '').trim(),
      mlc: String(filters.mlc || '').trim(),
      city: String(filters.city || '').trim(),
      b_type: String(filters.b_type || '').trim(),
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
    reportTitle: payload.head_name,
    documentTitle: payload.head_name,
    period: `FROM ${payload.filters.sdt || '—'} TO ${payload.filters.edt || '—'}`,
    preparedBy: userName || '',
    combinedFilename: `${String(companyName || 'Company').replace(/\s+/g, '_')}_DispatchChallanChecklist_${stamp}.pdf`,
  };
}

function buildHtml(payload, metadata) {
  const rows = payload.rows
    .map(
      (r) => `<tr>
        <td>${esc(r.bill_date)}</td>
        <td class="num">${esc(r.bill_no)}${esc(r.b_type)}</td>
        <td>${esc(r.party_name)}</td>
        <td>${esc(r.city)}</td>
        <td>${esc(r.bk_name)}</td>
        <td>${esc(r.sup_name || r.sup_code)}</td>
        <td>${esc(r.item_name)}</td>
        <td>${esc(r.lot)}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.god_code)}</td>
        <td class="num">${r.bags ? fmt(r.bags, 0) : ''}</td>
        <td class="num">${r.katta ? fmt(r.katta, 0) : ''}</td>
        <td class="num">${r.hkatta ? fmt(r.hkatta, 0) : ''}</td>
        <td class="num">${r.packing ? fmt(r.packing, 0) : ''}</td>
        <td class="num">${fmt(r.weight, 3)}</td>
        <td class="num">${fmt(r.rate)}</td>
        <td class="num">${fmt(r.amount)}</td>
      </tr>`
    )
    .join('');
  const t = payload.totals;
  return `<div class="report-doc dc-checklist">
    <style>
      * { box-sizing: border-box; }
      .dc-checklist { font-family: Arial, sans-serif; color: #111; border: 1px solid #bbb; padding: 10px 12px; }
      .dc-checklist__head { text-align: center; margin-bottom: 9px; }
      .dc-checklist__company { font-size: 15px; font-weight: 700; text-transform: uppercase; }
      .dc-checklist__title { font-size: 13px; font-weight: 700; margin-top: 2px; }
      .dc-checklist__period { font-size: 9px; margin-top: 3px; }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 6.5px; }
      th, td { border: 1px solid #ccc; padding: 2px; line-height: 1.1; vertical-align: top; word-break: break-word; }
      th { background: #eee; text-align: left; }
      .num { text-align: right; white-space: nowrap; }
      tfoot td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
    </style>
    <div class="dc-checklist__head">
      <div class="dc-checklist__company">${esc(metadata.companyName)}</div>
      <div class="dc-checklist__title">${esc(payload.head_name || metadata.reportTitle)}</div>
      <div class="dc-checklist__period">${esc(metadata.period)}</div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Ch.No</th><th>Party</th><th>City</th><th>Broker</th><th>Supplier</th>
          <th>Item</th><th>Lot</th><th>BKH</th><th>God</th>
          <th class="num">Bags</th><th class="num">Katta</th><th class="num">HKatta</th>
          <th class="num">Pkg</th><th class="num">Weight</th><th class="num">Rate</th><th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="17">(No rows)</td></tr>'}</tbody>
      <tfoot>
        <tr>
          <td colspan="10">TOTAL</td>
          <td class="num">${fmt(t.bags, 0)}</td>
          <td class="num">${fmt(t.katta, 0)}</td>
          <td class="num">${fmt(t.hkatta, 0)}</td>
          <td></td>
          <td class="num">${fmt(t.weight, 3)}</td>
          <td></td>
          <td class="num">${fmt(t.amount)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

async function buildContext(apiBase, ctx) {
  const payload = buildDispatchChallanChecklistPayload(ctx.rows, ctx.filters, ctx.headName);
  const company = await fetchCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildMetadata(payload, company, ctx.formData, ctx.userName);
  return { payload, metadata, html: buildHtml(payload, metadata) };
}

export async function exportDispatchChallanChecklistPdf(apiBase, ctx) {
  const { html, metadata } = await buildContext(apiBase, ctx);
  await downloadCombinedReportPdf('purchase-order-print', [html], metadata);
}

export async function shareDispatchChallanChecklistWhatsApp(apiBase, ctx) {
  const { payload, html, metadata } = await buildContext(apiBase, ctx);
  const { blob, filename } = await getCombinedReportPdfBlob('purchase-order-print', [html], metadata);
  const shareText = `${metadata.companyName}\n${metadata.reportTitle}\n${metadata.period}`;
  await sharePdfWithWhatsApp('purchase-order-print', payload, metadata, shareText, {
    prebuiltBlob: blob,
    prebuiltFilename: filename,
  });
}

export async function printDispatchChallanChecklist(apiBase, ctx) {
  const { html, metadata } = await buildContext(apiBase, ctx);
  const { blob } = await getCombinedReportPdfBlob('purchase-order-print', [html], metadata);
  await printPdfBlob(blob);
}

export function downloadDispatchChallanChecklistExcel(ctx) {
  const payload = buildDispatchChallanChecklistPayload(ctx.rows, ctx.filters, ctx.headName);
  const rows = payload.rows.map((r) => ({
    Date: r.bill_date,
    'Ch.No': `${r.bill_no}${r.b_type}`,
    Party: r.party_name,
    City: r.city,
    'L/C': r.l_c,
    Broker: r.bk_name,
    'Sup Code': r.sup_code,
    Supplier: r.sup_name,
    Item: r.item_name,
    Lot: r.lot,
    BKH: r.status,
    God: r.god_code,
    Bags: r.bags,
    Katta: r.katta,
    HKatta: r.hkatta,
    Pkg: r.packing,
    Weight: r.weight,
    Rate: r.rate,
    Amount: r.amount,
    Truck: r.truck_no,
    Marka: r.marka,
  }));
  if (!rows.length) throw new Error('No rows to export.');
  const comp = ctx.formData?.comp_name || ctx.formData?.COMP_NAME || 'Company';
  downloadExcelRows(rows, 'DCChecklist', `${String(comp).replace(/\s+/g, '_')}_Dispatch_Challan_List`);
}
