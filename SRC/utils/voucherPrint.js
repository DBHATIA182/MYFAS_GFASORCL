import axios from 'axios';
import { toOracleDate } from './dateFormat';
import { generatePDF, sharePdfWithWhatsApp, getPdfBlob, printPdfBlob } from './pdfgenerator';
import { rowFieldAny } from './rowFieldCI';

function textVal(row, keys) {
  for (const k of keys) {
    const v = rowFieldAny(row, [k, String(k).toLowerCase()]);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

export function mapCompdetPrintHeader(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    companyName: textVal(row, ['COMP_NAME', 'comp_name']),
    add1: textVal(row, ['COMP_ADD1', 'comp_add1']),
    add2: textVal(row, ['COMP_ADD2', 'comp_add2']),
    email: textVal(row, ['EMAIL', 'email']),
    tel1: textVal(row, ['COMP_TEL1', 'comp_tel1']),
    tel2: textVal(row, ['COMP_TEL2', 'comp_tel2']),
    tel3: textVal(row, ['COMP_TEL3', 'comp_tel3']),
    cin: textVal(row, ['CIN_NO', 'cin_no']),
    pan: textVal(row, ['COMP_PAN', 'comp_pan']),
    gst: textVal(row, ['GST_NO', 'gst_no', 'GSTIN']),
    fssai: textVal(row, ['FSSAI_NO', 'fssai_no']),
    billSlogan: textVal(row, ['BILL_SLOGAN', 'bill_slogan', 'G_BILL_SLOGAN']),
    bHeader: textVal(row, ['B_HEADER', 'b_header', 'G_B_HEADER']),
  };
}

export async function fetchVoucherPrintBundle(apiBase, { compCode, compUid, vrType, vrDate, vrNo }) {
  const oracleDt = toOracleDate(vrDate);
  const no = Number(vrNo) || 0;
  if (!compCode || !oracleDt || !no) {
    throw new Error('Save or load a voucher (date + number) before printing.');
  }
  const params = {
    comp_code: compCode,
    comp_uid: compUid,
    vr_type: vrType,
    vr_date: oracleDt,
    vr_no: no,
  };
  const printRes = await axios.get(`${apiBase}/api/voucher-entry/print`, {
    params,
    withCredentials: true,
    timeout: 30000,
  });
  let company = {};
  try {
    const headerRes = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    company = mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('Voucher print: company header unavailable', err?.message || err);
  }
  const payload = printRes.data;
  return { payload, company };
}

export function buildVoucherPrintMetadata({ payload, company, formData, userName, vrType }) {
  const h = payload?.header || {};
  const party = payload?.party || {};
  const isReceipt = payload?.format === 'receipt';
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    vrType: vrType || payload?.vr_type || 'CV',
    documentTitle: payload?.document_title || 'VOUCHER',
    format: payload?.format || 'voucher',
    isReceipt,
    vrDate: h.vr_date,
    vrNo: h.document_no ?? h.vr_no,
    receiptNo: h.receipt_no ?? h.r_c_no ?? h.vr_no,
    receiptType: h.type,
    preparedBy: userName || '',
    partyTel: party.tel || '',
    partyName: party.name || '',
    partyCode: party.code || '',
    autoOpen: false,
  };
}

export async function exportVoucherPdf(apiBase, ctx) {
  const { payload, company } = await fetchVoucherPrintBundle(apiBase, ctx);
  const metadata = buildVoucherPrintMetadata({ payload, company, ...ctx });
  await generatePDF('voucher-print', payload, metadata);
}

export async function shareVoucherWhatsApp(apiBase, ctx) {
  const { payload, company } = await fetchVoucherPrintBundle(apiBase, ctx);
  const metadata = buildVoucherPrintMetadata({ payload, company, ...ctx });
  const label = metadata.isReceipt ? 'Receipt' : metadata.documentTitle;
  const no = metadata.isReceipt ? metadata.receiptNo : metadata.vrNo;
  const shareText = `${metadata.companyName} — ${label} No. ${no} dated ${metadata.vrDate}`;
  await sharePdfWithWhatsApp('voucher-print', payload, metadata, shareText);
}

export async function printVoucherBrowser(apiBase, ctx) {
  const { payload, company } = await fetchVoucherPrintBundle(apiBase, ctx);
  const metadata = buildVoucherPrintMetadata({ payload, company, ...ctx });
  const { blob } = await getPdfBlob('voucher-print', payload, metadata);
  await printPdfBlob(blob);
}
