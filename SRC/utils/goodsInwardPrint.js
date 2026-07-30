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

function statusUnit(status) {
  const s = String(status || 'B').trim().toUpperCase();
  if (s === 'B') return 'BAGS';
  if (s === 'K') return 'KATTA';
  if (s === 'H') return 'HKATTA';
  return '';
}

export function normalizeGoodsInwardPrintBatch(data) {
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  return {
    head_name: data?.head_name || 'GATE PASS/INWARD',
    rtype: data?.rtype || 'IN',
    notes: notes.map((note) => {
      const h = note?.header || {};
      const lines = (note?.lines || []).map((ln, idx) => ({
        sno: idx + 1,
        ...ln,
        status_unit: ln.status_unit || statusUnit(ln.status),
      }));
      let qnty = 0;
      let packing = 0;
      let g_weight = 0;
      let d_weight = 0;
      let weight = 0;
      let amount = 0;
      for (const ln of lines) {
        qnty += num(ln.qnty);
        packing += num(ln.packing);
        g_weight += num(ln.g_weight);
        d_weight += num(ln.d_weight);
        weight += num(ln.weight);
        amount += num(ln.amount);
      }
      return {
        header: {
          ...h,
          bill_date: fmtDate(h.bill_date),
          head_name: h.head_name || data?.head_name || 'GATE PASS/INWARD',
        },
        lines,
        totals: note?.totals || { qnty, packing, g_weight, d_weight, weight, amount },
      };
    }),
  };
}

export function buildGoodsInwardPrintPayloadFromForm(header, lines, totals) {
  const h = header || {};
  const itemLines = (lines || [])
    .filter((ln) => ln.item_code)
    .map((ln, idx) => {
      const status = String(ln.status || 'B').trim().toUpperCase() || 'B';
      return {
        sno: idx + 1,
        trn_no: idx + 1,
        po_no: Number(ln.po_no) || 0,
        item_code: ln.item_code,
        item_name: ln.item_name || '',
        bard_item_code: ln.bard_item_code || '',
        bard_item_name: ln.bard_item_name || '',
        status,
        status_unit: statusUnit(status),
        packing: num(ln.packing),
        qnty: num(ln.qnty),
        g_weight: num(ln.g_weight),
        d_weight: num(ln.d_weight),
        weight: num(ln.weight),
        rate: num(ln.rate),
        amount: num(ln.amount),
        cost_code: ln.cost_code || '',
      };
    });
  return normalizeGoodsInwardPrintBatch({
    head_name: 'GATE PASS/INWARD',
    rtype: 'IN',
    notes: [
      {
        header: {
          bill_no: h.bill_no,
          bill_date: fmtDate(h.bill_date),
          head_name: 'GATE PASS/INWARD',
          code: h.code,
          party_name: h.party_name,
          city: h.party_city || h.city || '',
          bk_code: h.bk_code,
          bk_name: h.bk_name,
          truck_no: h.truck_no,
          time_in: h.time_in,
          time_out: h.time_out,
          gr_no: h.gr_no,
          tpt: h.tpt,
          remarks: h.remarks,
          dk_weight: num(h.dk_weight),
          dk_weight_empty: num(h.dk_weight_empty),
          dk_weight_net: num(h.dk_weight_net),
          bill_weight: num(h.bill_weight),
          gst_no: h.gst_no || '',
          state: h.state || '',
        },
        lines: itemLines,
        totals: {
          qnty: totals?.qnty ?? 0,
          packing: itemLines.reduce((s, ln) => s + num(ln.packing), 0),
          g_weight: itemLines.reduce((s, ln) => s + num(ln.g_weight), 0),
          d_weight: itemLines.reduce((s, ln) => s + num(ln.d_weight), 0),
          weight: totals?.weight ?? 0,
          amount: totals?.amount ?? 0,
        },
      },
    ],
  });
}

async function fetchGiCompany(apiBase, compCode, compUid) {
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
      /* optional */
    }
    return company;
  } catch (err) {
    console.warn('Goods inward print: company header unavailable', err?.message || err);
    return {};
  }
}

function buildGiMetadata({ payload, company, formData, userName }) {
  const first = payload?.notes?.[0]?.header || {};
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    documentTitle: payload?.head_name || first.head_name || 'GATE PASS/INWARD',
    billNo: first.bill_no,
    billDate: first.bill_date,
    preparedBy: userName || '',
    autoOpen: false,
  };
}

export function buildGoodsInwardPrintPreviewHtml(payload, metadata) {
  return buildReportHtml('goods-inward-print', payload, metadata);
}

export async function fetchGoodsInwardPrintBatch(apiBase, apiParams, { sbno, ebno, rtype = 'IN' } = {}) {
  const { data } = await axios.get(`${apiBase}/api/goods-inward/print-batch`, {
    params: {
      ...apiParams,
      sbno: sbno || 1,
      ebno: ebno || sbno || 1,
      rtype,
    },
    ...reqOpts,
  });
  return normalizeGoodsInwardPrintBatch(data);
}

export async function buildGoodsInwardPrintContext(apiBase, ctx, payload) {
  const company = await fetchGiCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildGiMetadata({ payload, company, formData: ctx.formData, userName: ctx.userName });
  return { payload, metadata, company };
}

export async function exportGoodsInwardPdf(apiBase, ctx, payloadOverride = null) {
  const payload =
    payloadOverride || buildGoodsInwardPrintPayloadFromForm(ctx.header, ctx.lines, ctx.totals);
  const { metadata } = await buildGoodsInwardPrintContext(apiBase, ctx, payload);
  await generatePDF('goods-inward-print', payload, metadata);
}

export async function shareGoodsInwardWhatsApp(apiBase, ctx, payloadOverride = null) {
  const payload =
    payloadOverride || buildGoodsInwardPrintPayloadFromForm(ctx.header, ctx.lines, ctx.totals);
  const { metadata } = await buildGoodsInwardPrintContext(apiBase, ctx, payload);
  const shareText = `${metadata.companyName} — ${metadata.documentTitle} No. ${metadata.billNo} dated ${metadata.billDate}`;
  await sharePdfWithWhatsApp('goods-inward-print', payload, metadata, shareText);
}

export async function printGoodsInwardBrowser(apiBase, ctx, payloadOverride = null) {
  const payload =
    payloadOverride || buildGoodsInwardPrintPayloadFromForm(ctx.header, ctx.lines, ctx.totals);
  const { metadata } = await buildGoodsInwardPrintContext(apiBase, ctx, payload);
  const { blob } = await getPdfBlob('goods-inward-print', payload, metadata);
  await printPdfBlob(blob);
}

export function downloadGoodsInwardPrintExcel(batchPayload, formData) {
  const notes = Array.isArray(batchPayload?.notes) ? batchPayload.notes : [];
  const rows = [];
  for (const note of notes) {
    const h = note.header || {};
    for (const ln of note.lines || []) {
      rows.push({
        'Inward No.': h.bill_no,
        Dated: fmtDate(h.bill_date),
        Party: h.party_name,
        Broker: h.bk_name,
        'Truck No.': h.truck_no,
        'Po.No.': ln.po_no,
        Commodity: ln.item_name,
        Bardana: ln.bard_item_name,
        Unit: ln.status_unit,
        Qty: ln.qnty,
        Pkg: ln.packing,
        'G.Weight': ln.g_weight,
        Dana: ln.d_weight,
        'Net Weight': ln.weight,
        Rate: ln.rate,
        Amount: ln.amount,
        Cost: ln.cost_code,
      });
    }
  }
  const comp = formData?.comp_name || formData?.COMP_NAME || 'Company';
  downloadExcelRows(rows, 'InwardPrint', `${comp}_Goods_Inward_Print`.replace(/\s+/g, '_'));
}
