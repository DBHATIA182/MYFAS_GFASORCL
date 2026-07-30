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

async function fetchPoCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('PO checklist: company header unavailable', err?.message || err);
    return {};
  }
}

export function buildPurchaseOrderChecklistPayload(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  let totQty = 0;
  let totWeight = 0;
  let totAmount = 0;
  let totAdvance = 0;
  const detailRows = list.map((row, idx) => {
    const qnty = num(row.qnty);
    const weight = num(row.weight);
    const amount = num(row.amount);
    const drAmt = num(row.dr_amt);
    totQty += qnty;
    totWeight += weight;
    totAmount += amount;
    totAdvance += drAmt;
    return {
      sno: idx + 1,
      so_date: fmtDate(row.so_date),
      so_no: Number(row.so_no) || 0,
      delv_date: fmtDate(row.delv_date),
      code: String(row.code || '').trim(),
      party_name: String(row.party_name || '').trim(),
      broker_supplier: [row.bk_name, row.sup_name].map((v) => String(v || '').trim()).filter(Boolean).join(' / '),
      item_name: String(row.item_name || '').trim(),
      loc_code: String(row.loc_code || '').trim(),
      god_code: String(row.god_code || '').trim(),
      qnty,
      weight,
      rate: num(row.rate),
      amount,
      dr_amt: drAmt,
      po_no: String(row.po_no || '').trim(),
      remarks: String(row.remarks || '').trim(),
    };
  });
  return {
    filters: {
      sdt: fmtDate(filters.sdt),
      edt: fmtDate(filters.edt),
      sbno: Number(filters.sbno) || 1,
      ebno: Number(filters.ebno) || 999999,
      code: String(filters.code || '').trim(),
      bk_code: String(filters.bk_code || '').trim(),
      sup_code: String(filters.sup_code || '').trim(),
      item_code: Number(filters.item_code) || 0,
      loc_code: String(filters.loc_code || '').trim(),
      god_code: String(filters.god_code || '').trim(),
    },
    rows: detailRows,
    totals: {
      qnty: totQty,
      weight: totWeight,
      amount: totAmount,
      dr_amt: totAdvance,
    },
  };
}

function buildChecklistMetadata({ payload, company, formData, userName }) {
  const filters = payload?.filters || {};
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    year: formData?.comp_year ?? formData?.COMP_YEAR ?? '',
    reportTitle: 'PURCHASE ORDER CHECKLIST',
    period: `FROM ${filters.sdt || '—'} TO ${filters.edt || '—'}`,
    documentTitle: 'PURCHASE ORDER CHECKLIST',
    preparedBy: userName || '',
  };
}

export async function exportPurchaseOrderChecklistPdf(apiBase, ctx) {
  const payload = buildPurchaseOrderChecklistPayload(ctx.rows, ctx.filters);
  const company = await fetchPoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  await generatePDF('purchase-order-checklist', payload, metadata);
}

export async function sharePurchaseOrderChecklistWhatsApp(apiBase, ctx) {
  const payload = buildPurchaseOrderChecklistPayload(ctx.rows, ctx.filters);
  const company = await fetchPoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  const shareText = `${metadata.companyName}\n${metadata.reportTitle}\n${metadata.period}`;
  await sharePdfWithWhatsApp('purchase-order-checklist', payload, metadata, shareText);
}

export async function printPurchaseOrderChecklist(apiBase, ctx) {
  const payload = buildPurchaseOrderChecklistPayload(ctx.rows, ctx.filters);
  const company = await fetchPoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildChecklistMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  const { blob } = await getPdfBlob('purchase-order-checklist', payload, metadata);
  await printPdfBlob(blob);
}

export function downloadPurchaseOrderChecklistExcel(rows, formData) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error('No rows to export.');
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
  downloadExcelRows(
    list.map((row) => ({
      Date: fmtDate(row.so_date),
      'No.': Number(row.so_no) || 0,
      'Delv.Date': fmtDate(row.delv_date),
      'Party Code': String(row.code || '').trim(),
      'Party Name': String(row.party_name || '').trim(),
      'Broker / Supplier': [row.bk_name, row.sup_name].map((v) => String(v || '').trim()).filter(Boolean).join(' / '),
      'Item Name': String(row.item_name || '').trim(),
      'Loc.': String(row.loc_code || '').trim(),
      'God.': String(row.god_code || '').trim(),
      Qty: num(row.qnty),
      Weight: num(row.weight),
      Rate: num(row.rate),
      Amount: num(row.amount),
      'Adv.Amount': num(row.dr_amt),
      'P.O.No.': String(row.po_no || '').trim(),
      Remarks: String(row.remarks || '').trim(),
    })),
    'POChecklist',
    `${compName}_POChecklist`
  );
}
