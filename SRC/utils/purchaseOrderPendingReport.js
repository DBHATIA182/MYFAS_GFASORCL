import axios from 'axios';
import { formatLedgerDateDisplay, toDisplayDate, toOracleDate } from './dateFormat';
import { downloadExcelRows } from './excelExport';
import { buildReportHtml, generatePDF, getPdfBlob, printPdfBlob, sharePdfWithWhatsApp } from './pdfgenerator';
import { mapCompdetPrintHeader } from './voucherPrint';

const reqOpts = { withCredentials: true, timeout: 120000 };

function apiRoot(apiBase) {
  return apiBase == null ? '' : String(apiBase);
}

async function fetchPoCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiRoot(apiBase)}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('PO pending: company header unavailable', err?.message || err);
    return {};
  }
}

function fmtDate(v) {
  return formatLedgerDateDisplay(v) || String(v || '').trim();
}

function buildMetadata({ payload, company, formData }) {
  const from = fmtDate(payload?.s_date) || '—';
  const to = fmtDate(payload?.e_date) || '—';
  return {
    companyName: company.companyName || formData?.comp_name || formData?.COMP_NAME || '',
    company,
    reportTitle: payload?.head_name || 'PENDING PURCHASE ORDER LIST',
    period: `FROM ${from} TO ${to}`,
    autoOpen: false,
  };
}

export function buildPurchaseOrderPendingPreviewHtml(payload, metadata) {
  const type =
    payload?.report_type === 'detail' ? 'purchase-order-pending-detail' : 'purchase-order-pending-summary';
  return buildReportHtml(type, payload, metadata);
}

export async function fetchPurchaseOrderPending(apiBase, apiParams, mode, filters) {
  const path =
    mode === 'detail' ? '/api/purchase-order/pending-detail' : '/api/purchase-order/pending-summary';
  const { data } = await axios.get(`${apiRoot(apiBase)}${path}`, {
    params: {
      ...apiParams,
      sdt: toOracleDate(filters.sdt),
      edt: toOracleDate(filters.edt),
      code: filters.code || undefined,
      item_code: filters.item_code || undefined,
      bk_code: filters.bk_code || undefined,
      sup_code: filters.sup_code || undefined,
      god_code: filters.god_code || undefined,
      loc_code: filters.loc_code || undefined,
      so_no: filters.so_no || undefined,
      qnty_ignore: filters.qnty_ignore ?? 0,
    },
    ...reqOpts,
  });
  return data;
}

export async function buildPurchaseOrderPendingContext(apiBase, ctx, payload) {
  const company = await fetchPoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildMetadata({ payload, company, formData: ctx.formData });
  return { payload, metadata, company };
}

function reportType(mode) {
  return mode === 'detail' ? 'purchase-order-pending-detail' : 'purchase-order-pending-summary';
}

export async function exportPurchaseOrderPendingPdf(apiBase, ctx, payload, mode) {
  const { metadata } = await buildPurchaseOrderPendingContext(apiBase, ctx, payload);
  await generatePDF(reportType(mode), payload, metadata);
}

export async function sharePurchaseOrderPendingWhatsApp(apiBase, ctx, payload, mode) {
  const { metadata } = await buildPurchaseOrderPendingContext(apiBase, ctx, payload);
  const shareText = `${metadata.companyName} — ${metadata.reportTitle} ${metadata.period}`;
  await sharePdfWithWhatsApp(reportType(mode), payload, metadata, shareText);
}

export async function printPurchaseOrderPending(apiBase, ctx, payload, mode) {
  const { metadata } = await buildPurchaseOrderPendingContext(apiBase, ctx, payload);
  const { blob } = await getPdfBlob(reportType(mode), payload, metadata);
  await printPdfBlob(blob);
}

export function downloadPurchaseOrderPendingExcel(payload, formData, mode) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) throw new Error('No rows to export.');
  const comp = String(formData?.comp_name ?? formData?.COMP_NAME ?? 'Company').trim() || 'Company';
  if (mode === 'detail') {
    downloadExcelRows(
      rows.map((r) => ({
        Party: r.name,
        Code: r.code,
        'Item Name': r.item_name,
        Date: fmtDate(r.so_date),
        'So.No.': r.so_no,
        Loc: r.loc_code,
        God: r.god_code,
        'B.No.': r.m_type === 1 ? '' : r.bill_no || r.r_no,
        'B/K/H': r.status,
        OQTY: r.so_qty,
        SQTY: r.sl_qty,
        BQTY: r.bqty,
        OWgt: r.so_wgt,
        SWgt: r.sl_wgt,
        BWgt: r.bwgt,
        Rate: r.rate,
        Broker: r.bk_name,
      })),
      'POPendingDet',
      `${comp}_POPendingDet`
    );
    return;
  }
  downloadExcelRows(
    rows.map((r) => ({
      Party: r.name,
      Code: r.code,
      Broker: r.bk_name,
      Supplier: r.sup_name,
      'Item Name': r.item_name,
      Loc: r.loc_code,
      God: r.god_code,
      'So.Date': fmtDate(r.so_date),
      'So.No.': r.so_no,
      Oqty: r.oqty,
      SQty: r.rqty,
      BQty: r.bqty,
      OWgt: r.owgt,
      SWgt: r.rwgt,
      BWgt: r.bwgt,
      Rate: r.rate,
      Remarks: r.remarks,
      'Delv.Mth': r.delv_mth,
    })),
    'POPendingSum',
    `${comp}_POPendingSum`
  );
}
