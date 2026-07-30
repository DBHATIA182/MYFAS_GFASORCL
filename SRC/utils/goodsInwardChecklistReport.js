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

async function fetchGiCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('Goods inward checklist: company header unavailable', err?.message || err);
    return {};
  }
}

export function buildGoodsInwardChecklistPayload(rows, filters = {}, headName = 'INWARD REGISTER') {
  const list = Array.isArray(rows) ? rows : [];
  let totQty = 0;
  let totWeight = 0;
  let totAmount = 0;
  const detailRows = list.map((row, idx) => {
    const qnty = num(row.qnty);
    const weight = num(row.weight);
    const amount = num(row.amount);
    totQty += qnty;
    totWeight += weight;
    totAmount += amount;
    return {
      sno: idx + 1,
      bill_date: fmtDate(row.bill_date),
      bill_no: Number(row.bill_no) || 0,
      sb_no: Number(row.sb_no) || 0,
      trn_no: Number(row.trn_no) || 0,
      code: String(row.code || '').trim(),
      party_name: String(row.party_name || '').trim(),
      city: String(row.city || '').trim(),
      bk_name: String(row.bk_name || '').trim(),
      po_no: Number(row.po_no) || 0,
      item_name: String(row.item_name || '').trim(),
      bard_item_name: String(row.bard_item_name || '').trim(),
      status: String(row.status || '').trim(),
      packing: num(row.packing),
      qnty,
      g_weight: num(row.g_weight),
      d_weight: num(row.d_weight),
      weight,
      rate: num(row.rate),
      amount,
      god_code: String(row.god_code || '').trim(),
      cost_code: String(row.cost_code || '').trim(),
      truck_no: String(row.truck_no || '').trim(),
      remarks: String(row.remarks || '').trim(),
    };
  });
  return {
    head_name: headName,
    filters: {
      sdt: fmtDate(filters.sdt),
      edt: fmtDate(filters.edt),
      sbno: Number(filters.sbno) || 1,
      ebno: Number(filters.ebno) || 999999,
      code: String(filters.code || '').trim(),
      bk_code: String(filters.bk_code || '').trim(),
      item_code: Number(filters.item_code) || 0,
      god_code: String(filters.god_code || '').trim(),
      pending_only: String(filters.pending_only || '').trim().toUpperCase() === 'Y',
    },
    rows: detailRows,
    totals: { qnty: totQty, weight: totWeight, amount: totAmount },
  };
}

function buildChecklistMetadata({ payload, company, formData, userName }) {
  const filters = payload?.filters || {};
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    year: formData?.comp_year ?? formData?.COMP_YEAR ?? '',
    reportTitle: payload?.head_name || 'INWARD REGISTER',
    period: `FROM ${filters.sdt || '—'} TO ${filters.edt || '—'}`,
    documentTitle: payload?.head_name || 'INWARD REGISTER',
    preparedBy: userName || '',
  };
}

export async function exportGoodsInwardChecklistPdf(apiBase, ctx) {
  const payload = buildGoodsInwardChecklistPayload(ctx.rows, ctx.filters, ctx.headName);
  const company = await fetchGiCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  await generatePDF('goods-inward-checklist', payload, metadata);
}

export async function shareGoodsInwardChecklistWhatsApp(apiBase, ctx) {
  const payload = buildGoodsInwardChecklistPayload(ctx.rows, ctx.filters, ctx.headName);
  const company = await fetchGiCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  const shareText = `${metadata.companyName}\n${metadata.reportTitle}\n${metadata.period}`;
  await sharePdfWithWhatsApp('goods-inward-checklist', payload, metadata, shareText);
}

export async function printGoodsInwardChecklist(apiBase, ctx) {
  const payload = buildGoodsInwardChecklistPayload(ctx.rows, ctx.filters, ctx.headName);
  const company = await fetchGiCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  const { blob } = await getPdfBlob('goods-inward-checklist', payload, metadata);
  await printPdfBlob(blob);
}

export function downloadGoodsInwardChecklistExcel(rows, formData) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error('No rows to export.');
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
  downloadExcelRows(
    list.map((row) => ({
      Date: fmtDate(row.bill_date),
      'No.': Number(row.bill_no) || 0,
      'SB No.': Number(row.sb_no) || 0,
      'Party Code': String(row.code || '').trim(),
      'Party Name': String(row.party_name || '').trim(),
      City: String(row.city || '').trim(),
      Broker: String(row.bk_name || '').trim(),
      'Po.No.': Number(row.po_no) || 0,
      'Item Name': String(row.item_name || '').trim(),
      Bardana: String(row.bard_item_name || '').trim(),
      Status: String(row.status || '').trim(),
      Pkg: num(row.packing),
      Qty: num(row.qnty),
      'G.Weight': num(row.g_weight),
      'D.Weight': num(row.d_weight),
      'Net Weight': num(row.weight),
      Rate: num(row.rate),
      Amount: num(row.amount),
      Godown: String(row.god_code || '').trim(),
      Cost: String(row.cost_code || '').trim(),
      'Truck No.': String(row.truck_no || '').trim(),
      Remarks: String(row.remarks || '').trim(),
    })),
    'InwardChecklist',
    `${compName}_Inward_Checklist`
  );
}
