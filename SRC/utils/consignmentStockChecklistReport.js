import axios from 'axios';
import { toDisplayDate } from './dateFormat';
import { downloadExcelRows } from './excelExport';
import { generatePDF, getPdfBlob, printPdfBlob, sharePdfWithWhatsApp } from './pdfgenerator';
import { mapCompdetPrintHeader } from './voucherPrint';

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v) {
  return toDisplayDate(v) || String(v || '').trim();
}

function fmtBno(row) {
  const type = String(row.type || '').trim().toUpperCase();
  const bNo = Number(row.b_no) || 0;
  if (!bNo && !type) return '';
  return type ? `${type} ${bNo}` : String(bNo);
}

async function fetchCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiBase || ''}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('Consignment stock checklist: company header unavailable', err?.message || err);
    return {};
  }
}

export function buildConsignmentStockChecklistPayload(rows, filters = {}, totalsIn = null) {
  const list = Array.isArray(rows) ? rows : [];
  let totBags = 0;
  let totKatta = 0;
  let totHkatta = 0;
  let totWeight = 0;
  let totAmount = 0;
  const detailRows = list.map((row, idx) => {
    const bags = num(row.bags);
    const katta = num(row.katta);
    const hkatta = num(row.hkatta);
    const weight = num(row.weight);
    const amount = num(row.amount);
    totBags += bags;
    totKatta += katta;
    totHkatta += hkatta;
    totWeight += weight;
    totAmount += amount;
    return {
      sno: idx + 1,
      r_date: fmtDate(row.r_date),
      r_no: Number(row.r_no) || 0,
      b_no: Number(row.b_no) || 0,
      b_no_disp: fmtBno(row),
      type: String(row.type || '').trim().toUpperCase(),
      item_code: Number(row.item_code) || 0,
      item_name: String(row.item_name || '').trim(),
      god_code: String(row.god_code || '').trim(),
      lot: Number(row.lot) || 0,
      party_name: String(row.party_name || '').trim(),
      bags,
      katta,
      hkatta,
      weight,
      amount,
      f_form: String(row.f_form || '').trim(),
      labour: String(row.labour || '').trim(),
      l_c: String(row.l_c || '').trim(),
      exp_cat: String(row.exp_cat || '').trim(),
      truck_no: String(row.truck_no || '').trim(),
      gr_no: String(row.gr_no || '').trim(),
    };
  });
  const totals = totalsIn
    ? {
        bags: num(totalsIn.bags),
        katta: num(totalsIn.katta),
        hkatta: num(totalsIn.hkatta),
        weight: num(totalsIn.weight),
        amount: num(totalsIn.amount),
      }
    : { bags: totBags, katta: totKatta, hkatta: totHkatta, weight: totWeight, amount: totAmount };
  return {
    head_name: 'CONSIGNMENT STOCK LIST',
    filters: {
      sdt: fmtDate(filters.sdt),
      edt: fmtDate(filters.edt),
      code: String(filters.code || '').trim(),
      msup_code: String(filters.msup_code || '').trim(),
      item_code: Number(filters.item_code) || 0,
      god_code: String(filters.god_code || '').trim(),
      mode: String(filters.mode || 'C').trim().toUpperCase().slice(0, 1) || 'C',
    },
    rows: detailRows,
    totals,
  };
}

function buildChecklistMetadata({ payload, company, formData, userName }) {
  const filters = payload?.filters || {};
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    year: formData?.comp_year ?? formData?.COMP_YEAR ?? '',
    reportTitle: payload?.head_name || 'CONSIGNMENT STOCK LIST',
    period: `FROM ${filters.sdt || '—'} TO ${filters.edt || '—'}`,
    documentTitle: payload?.head_name || 'CONSIGNMENT STOCK LIST',
    preparedBy: userName || '',
  };
}

export async function exportConsignmentStockChecklistPdf(apiBase, ctx) {
  const payload = buildConsignmentStockChecklistPayload(ctx.rows, ctx.filters, ctx.totals);
  const company = await fetchCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  await generatePDF('consignment-stock-checklist', payload, metadata);
}

export async function shareConsignmentStockChecklistWhatsApp(apiBase, ctx) {
  const payload = buildConsignmentStockChecklistPayload(ctx.rows, ctx.filters, ctx.totals);
  const company = await fetchCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  const shareText = `${metadata.companyName}\n${metadata.reportTitle}\n${metadata.period}`;
  await sharePdfWithWhatsApp('consignment-stock-checklist', payload, metadata, shareText);
}

export async function printConsignmentStockChecklist(apiBase, ctx) {
  const payload = buildConsignmentStockChecklistPayload(ctx.rows, ctx.filters, ctx.totals);
  const company = await fetchCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  const { blob } = await getPdfBlob('consignment-stock-checklist', payload, metadata);
  await printPdfBlob(blob);
}

export function downloadConsignmentStockChecklistExcel(rows, formData) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error('No rows to export.');
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
  downloadExcelRows(
    list.map((row) => ({
      Date: fmtDate(row.r_date),
      'Sr.No.': Number(row.r_no) || 0,
      'B.No.': fmtBno(row),
      'Item Code': Number(row.item_code) || 0,
      'Item Name': String(row.item_name || '').trim(),
      Godown: String(row.god_code || '').trim(),
      Lot: Number(row.lot) || 0,
      Name: String(row.party_name || '').trim(),
      Bags: num(row.bags),
      Kata: num(row.katta),
      Hkatta: num(row.hkatta),
      Weight: num(row.weight),
      Amount: num(row.amount),
      Form: String(row.f_form || '').trim(),
      FB: String(row.labour || '').trim(),
      L: String(row.l_c || '').trim(),
      CAT: String(row.exp_cat || '').trim(),
      'Truck No.': String(row.truck_no || '').trim(),
      'G.R.No.': String(row.gr_no || '').trim(),
    })),
    'CstockChecklist',
    `${compName}_Consignment_Stock_List`
  );
}
