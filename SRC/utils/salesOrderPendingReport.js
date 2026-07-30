import axios from 'axios';
import { formatLedgerDateDisplay, toOracleDate } from './dateFormat';
import { downloadExcelRows } from './excelExport';
import { buildReportHtml, generatePDF, getPdfBlob, printPdfBlob, sharePdfWithWhatsApp } from './pdfgenerator';
import { mapCompdetPrintHeader } from './voucherPrint';

const reqOpts = { withCredentials: true, timeout: 120000 };

function apiRoot(apiBase) {
  return apiBase == null ? '' : String(apiBase);
}

async function fetchSoCompany(apiBase, compCode, compUid) {
  try {
    const headerRes = await axios.get(`${apiRoot(apiBase)}/api/compdet-ledger-header`, {
      params: { comp_code: compCode, comp_uid: compUid },
      withCredentials: true,
      timeout: 15000,
    });
    return mapCompdetPrintHeader(headerRes.data);
  } catch (err) {
    console.warn('SO pending: company header unavailable', err?.message || err);
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
    reportTitle: payload?.head_name || 'PENDING SALES ORDER LIST',
    period: `FROM ${from} TO ${to}`,
    autoOpen: false,
  };
}

function reportType(mode) {
  if (mode === 'detail') return 'sales-order-pending-detail';
  if (mode === 'so-do-sale') return 'sales-order-pending-so-do-sale';
  return 'sales-order-pending-summary';
}

export function buildSalesOrderPendingPreviewHtml(payload, metadata) {
  const type =
    payload?.report_type === 'detail'
      ? 'sales-order-pending-detail'
      : payload?.report_type === 'so-do-sale'
        ? 'sales-order-pending-so-do-sale'
        : 'sales-order-pending-summary';
  return buildReportHtml(type, payload, metadata);
}

export async function fetchSalesOrderPending(apiBase, apiParams, mode, filters) {
  const path =
    mode === 'detail'
      ? '/api/sales-order/pending-detail'
      : mode === 'so-do-sale'
        ? '/api/sales-order/pending-so-do-sale'
        : '/api/sales-order/pending-summary';
  const params = {
    ...apiParams,
    sdt: toOracleDate(filters.sdt),
    edt: toOracleDate(filters.edt),
    code: filters.code || undefined,
    item_code: filters.item_code || undefined,
    bk_code: filters.bk_code || undefined,
    so_no: filters.so_no || undefined,
    qnty_ignore: filters.qnty_ignore ?? 0,
    rake_truck: filters.rake_truck || undefined,
    d_e: filters.d_e || undefined,
    god_code: filters.god_code || undefined,
    msc: filters.msc || undefined,
  };
  if (mode === 'summary' || mode === 'date-wise') {
    params.rpt_type = mode === 'date-wise' ? 2 : 1;
  }
  const { data } = await axios.get(`${apiRoot(apiBase)}${path}`, { params, ...reqOpts });
  return data;
}

export async function buildSalesOrderPendingContext(apiBase, ctx, payload) {
  const company = await fetchSoCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildMetadata({ payload, company, formData: ctx.formData });
  return { payload, metadata, company };
}

export async function exportSalesOrderPendingPdf(apiBase, ctx, payload, mode) {
  const { metadata } = await buildSalesOrderPendingContext(apiBase, ctx, payload);
  await generatePDF(reportType(mode), payload, metadata);
}

export async function shareSalesOrderPendingWhatsApp(apiBase, ctx, payload, mode) {
  const { metadata } = await buildSalesOrderPendingContext(apiBase, ctx, payload);
  const shareText = `${metadata.companyName} — ${metadata.reportTitle} ${metadata.period}`;
  await sharePdfWithWhatsApp(reportType(mode), payload, metadata, shareText);
}

export async function printSalesOrderPending(apiBase, ctx, payload, mode) {
  const { metadata } = await buildSalesOrderPendingContext(apiBase, ctx, payload);
  const { blob } = await getPdfBlob(reportType(mode), payload, metadata);
  await printPdfBlob(blob);
}

export function downloadSalesOrderPendingExcel(payload, formData, mode) {
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
        God: r.god_code,
        'B.No.': r.m_type === 1 ? '' : r.bill_no,
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
      'SOPendingDet',
      `${comp}_SOPendingDet`
    );
    return;
  }
  if (mode === 'so-do-sale') {
    downloadExcelRows(
      rows.map((r) => ({
        Party: r.name,
        Code: r.code,
        'Item Name': r.item_name,
        Date: fmtDate(r.so_date),
        'So.No.': r.so_no,
        God: r.god_code,
        'B.No.': r.m_type === 1 ? '' : r.bill_no,
        'B/K/H': r.status,
        Type: r.sale_type,
        'SO Qty': r.so_qty,
        'DO Qty': r.do_qty,
        'SL Qty': r.sl_qty,
        BQty: r.bqty,
        'SO Wgt': r.so_wgt,
        'DO Wgt': r.do_wgt,
        'SL Wgt': r.sl_wgt,
        BWgt: r.bwgt,
        Rate: r.rate,
        Broker: r.bk_name,
        'Valid Date': r.valid_date,
      })),
      'SOPendingSoDoSale',
      `${comp}_SOPendingSoDoSale`
    );
    return;
  }
  downloadExcelRows(
    rows.map((r) => ({
      Party: r.name,
      Code: r.code,
      Broker: r.bk_name,
      'Item Name': r.item_name,
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
      'R/T': r.rake_truck,
      'D/E': r.d_e,
      'Delv.City': r.delv_city,
      Remarks: r.remarks,
    })),
    'SOPendingSum',
    `${comp}_SOPendingSum`
  );
}
