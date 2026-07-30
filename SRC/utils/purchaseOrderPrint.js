import axios from 'axios';
import { toDisplayDate } from './dateFormat';
import { downloadExcelRows } from './excelExport';
import { buildReportHtml, generatePDF, sharePdfWithWhatsApp, getPdfBlob, printPdfBlob } from './pdfgenerator';
import { mapCompdetPrintHeader } from './voucherPrint';

const reqOpts = { withCredentials: true, timeout: 120000 };

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v) {
  return toDisplayDate(v) || String(v || '').trim();
}

export function normalizePurchaseOrderPrintBatch(data, showPmtDue = true) {
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  return {
    show_pmt_due: data?.show_pmt_due ?? showPmtDue,
    orders: orders.map((order) => {
      const h = order?.header || {};
      const lines = (order?.lines || []).map((ln, idx) => ({
        sno: idx + 1,
        trn_no: ln.trn_no,
        item_code: ln.item_code,
        item_name: ln.item_name || '',
        hsn_code: ln.hsn_code || '',
        status: ln.status || 'B',
        status_unit: ln.status_unit || '',
        qnty: num(ln.qnty),
        weight: num(ln.weight),
        rate: num(ln.rate),
        amount: num(ln.amount),
      }));
      let qnty = 0;
      let weight = 0;
      let amount = 0;
      for (const ln of lines) {
        qnty += ln.qnty;
        weight += ln.weight;
        amount += ln.amount;
      }
      return {
        header: {
          ...h,
          so_date: fmtDate(h.so_date),
          delv_date: fmtDate(h.delv_date),
          pmt_due_date: fmtDate(h.pmt_due_date),
          show_pmt_due: h.show_pmt_due ?? showPmtDue,
        },
        lines,
        totals: order?.totals || { qnty, weight, amount },
      };
    }),
  };
}

export function buildPurchaseOrderPrintPayloadFromForm(header, lines, totals, showPmtDue = true) {
  const h = header || {};
  const itemLines = (lines || [])
    .filter((ln) => ln.item_code)
    .map((ln, idx) => {
      const status = String(ln.status || 'B').trim().toUpperCase() || 'B';
      let statusUnit = '';
      if (status === 'B') statusUnit = 'BAGS';
      else if (status === 'K') statusUnit = 'KATTA';
      else if (status === 'H') statusUnit = 'HKATTA';
      return {
        sno: idx + 1,
        trn_no: idx + 1,
        item_code: ln.item_code,
        item_name: ln.item_name || '',
        hsn_code: ln.hsn_code || '',
        status,
        status_unit: statusUnit,
        qnty: num(ln.qnty),
        weight: num(ln.weight),
        rate: num(ln.rate),
        amount: num(ln.amount),
      };
    });
  const pmtDays = num(h.pmt_due_days);
  let pmtDueDate = '';
  if (h.so_date && pmtDays) {
    const parts = String(h.so_date).split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() + pmtDays);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        pmtDueDate = `${dd}-${mm}-${d.getFullYear()}`;
      }
    }
  }
  return {
    orders: [
      {
        header: {
          so_no: h.so_no,
          so_date: fmtDate(h.so_date),
          delv_date: fmtDate(h.delv_date),
          pmt_due_days: pmtDays,
          pmt_due_date: pmtDueDate,
          show_pmt_due: showPmtDue,
          code: h.code,
          party_name: h.party_name,
          add1: h.add1 || '',
          add2: h.add2 || '',
          add3: h.add3 || '',
          city: h.city || '',
          tel_no: h.tel_no || '',
          gst_no: h.gst_no || '',
          bk_code: h.bk_code,
          bk_name: h.bk_name,
          po_no: h.po_no,
          p_condition: h.p_condition,
          delv_mth: h.delv_mth,
          remarks: h.remarks,
          remarks2: h.remarks2,
          remarks3: h.remarks3,
        },
        lines: itemLines,
        totals: {
          qnty: totals?.qnty ?? 0,
          weight: totals?.weight ?? 0,
          amount: totals?.amount ?? 0,
        },
      },
    ],
  };
}

/** @deprecated use buildPurchaseOrderPrintPayloadFromForm */
export function buildPurchaseOrderPrintPayload(header, lines, totals) {
  return buildPurchaseOrderPrintPayloadFromForm(header, lines, totals);
}

async function fetchPoCompany(apiBase, compCode, compUid) {
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
    console.warn('PO print: company header unavailable', err?.message || err);
    return {};
  }
}

function buildPoMetadata({ payload, company, formData, userName }) {
  const first = payload?.orders?.[0]?.header || payload?.header || {};
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    documentTitle: 'PURCHASE ORDER',
    soNo: first.so_no,
    soDate: first.so_date,
    preparedBy: userName || '',
    autoOpen: false,
  };
}

export function buildPurchaseOrderPrintPreviewHtml(payload, metadata) {
  return buildReportHtml('purchase-order-print', payload, metadata);
}

export async function fetchPurchaseOrderPrintBatch(apiBase, apiParams, { sbno, ebno, pmtDueYn = 'Y' } = {}) {
  const { data } = await axios.get(`${apiRoot(apiBase)}/api/purchase-order/print-batch`, {
    params: {
      ...apiParams,
      sbno: sbno || 1,
      ebno: ebno || sbno || 1,
      pmt_due_yn: pmtDueYn,
    },
    ...reqOpts,
  });
  return normalizePurchaseOrderPrintBatch(data, String(pmtDueYn).trim().toUpperCase() !== 'N');
}

function apiRoot(apiBase) {
  return apiBase == null ? '' : String(apiBase);
}

export async function buildPurchaseOrderPrintContext(apiBase, ctx, payload) {
  const company = await fetchPoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildPoMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  return { payload, metadata, company };
}

export async function exportPurchaseOrderPdf(apiBase, ctx, payloadOverride = null) {
  const payload =
    payloadOverride ||
    buildPurchaseOrderPrintPayloadFromForm(ctx.header, ctx.lines, ctx.totals, ctx.showPmtDue !== false);
  const { metadata } = await buildPurchaseOrderPrintContext(apiBase, ctx, payload);
  await generatePDF('purchase-order-print', payload, metadata);
}

export async function sharePurchaseOrderWhatsApp(apiBase, ctx, payloadOverride = null) {
  const payload =
    payloadOverride ||
    buildPurchaseOrderPrintPayloadFromForm(ctx.header, ctx.lines, ctx.totals, ctx.showPmtDue !== false);
  const { metadata } = await buildPurchaseOrderPrintContext(apiBase, ctx, payload);
  const shareText = `${metadata.companyName} — Purchase Order No. ${metadata.soNo} dated ${metadata.soDate}`;
  await sharePdfWithWhatsApp('purchase-order-print', payload, metadata, shareText);
}

export async function printPurchaseOrderBrowser(apiBase, ctx, payloadOverride = null) {
  const payload =
    payloadOverride ||
    buildPurchaseOrderPrintPayloadFromForm(ctx.header, ctx.lines, ctx.totals, ctx.showPmtDue !== false);
  const { metadata } = await buildPurchaseOrderPrintContext(apiBase, ctx, payload);
  const { blob } = await getPdfBlob('purchase-order-print', payload, metadata);
  await printPdfBlob(blob);
}

export function downloadPurchaseOrderPrintExcel(batchPayload, formData) {
  const orders = Array.isArray(batchPayload?.orders) ? batchPayload.orders : [];
  const rows = [];
  for (const order of orders) {
    const h = order.header || {};
    for (const ln of order.lines || []) {
      const qtyUnit = ln.status_unit ? `${ln.qnty} ${ln.status_unit}` : ln.qnty;
      rows.push({
        'Order No.': h.so_no,
        Dated: fmtDate(h.so_date),
        'Delv.Due Date': fmtDate(h.delv_date),
        'Pmt.Due Date': h.show_pmt_due !== false ? fmtDate(h.pmt_due_date) : '',
        Party: h.party_name,
        Broker: h.bk_name,
        'P.O.No.': h.po_no,
        Particulars: `${ln.trn_no || ln.sno || ''} ${ln.item_name || ''}`.trim(),
        HsnCode: ln.hsn_code,
        Qty: qtyUnit,
        Weight: ln.weight,
        Rate: ln.rate,
        Amount: ln.amount,
        'Payment Condition': h.p_condition,
        'Delivery Month': h.delv_mth,
        Remarks: h.remarks,
      });
    }
  }
  const comp = formData?.comp_name || formData?.COMP_NAME || 'Company';
  downloadExcelRows(rows, 'POPrint', `${comp}_Purchase_Order_Print`.replace(/\s+/g, '_'));
}
