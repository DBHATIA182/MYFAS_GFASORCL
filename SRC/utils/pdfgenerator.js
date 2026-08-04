import html2pdf from 'html2pdf.js';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { mergePdfBlobs, yieldToMain } from './mergePdfBlobs';
import { formatLedgerDateDisplay, toDisplayDate } from './dateFormat';
import { buildBrokerOsDisplayRows } from './brokerOsDisplay';
import { buildSaleListDisplayRows, saleListMeas } from './saleListDisplay';
import { rupeesToWords } from './rupeesInWords';
import { rowFieldCI, rowFieldAny } from './rowFieldCI';
import { ageingCurBalDisplay } from './ageingDisplay';
import { buildLedgerJsPdfBlob, assertLedgerPdfBlob } from './ledgerJsPdf';
import { sortTrialBalanceRows, trialBalanceRowKind, trialBalanceRowLabel, findTrialGrandRow } from './trialBalanceSort';
import {
  LABOUR_REPORT_GROUPS,
  labourRowValue,
  labourTotAmt,
  fmtLabourQty,
  fmtLabourAmt,
  labourGroupColSpan,
  sortLabourRowsByVrDate,
} from '../data/labourReportLayout';
import { apiUrl, getPublicWebOrigin } from './resolveApiBase';
import axios from 'axios';

function safeFilenamePart(name) {
  return String(name || 'report').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ledger PDF header: name · city · gst · pan (from MASTER row or first ledger line). */
export function buildLedgerPartyLine(row) {
  if (!row) return '';
  const name = String(row.NAME ?? row.name ?? '').trim();
  const city = String(row.CITY ?? row.city ?? '').trim();
  const gst = String(row.GST_NO ?? row.gst_no ?? '').trim();
  const pan = String(row.PAN ?? row.pan ?? '').trim();
  const parts = [];
  if (name) parts.push(name);
  if (city) parts.push(city);
  if (gst) parts.push(gst);
  if (pan) parts.push(pan);
  return parts.join(' · ');
}

/** Metadata for ledger account statement PDF (company + account address blocks). */
export function buildLedgerStatementPdfMetadata({
  formData,
  compLedgerHeader,
  account,
  ledgerFirstRow,
  year,
  endDate,
  accountNameOverride,
  accountCodeOverride,
}) {
  const fd = formData || {};
  const ch = compLedgerHeader && typeof compLedgerHeader === 'object' ? compLedgerHeader : {};
  const acc = account || ledgerFirstRow || {};
  const nameO =
    accountNameOverride != null && String(accountNameOverride).trim() !== ''
      ? String(accountNameOverride).trim()
      : rowFieldAny(acc, ['NAME', 'name']);
  const codeO =
    accountCodeOverride != null && String(accountCodeOverride).trim() !== ''
      ? String(accountCodeOverride).trim()
      : rowFieldAny(acc, ['CODE', 'code']);
  const companyName =
    rowFieldAny(ch, ['COMP_NAME', 'comp_name']) || String(fd.comp_name ?? fd.COMP_NAME ?? '').trim();
  return {
    companyName,
    year: year ?? fd.comp_year ?? fd.COMP_YEAR ?? '',
    accountName: nameO,
    accountCode: codeO,
    endDate,
    companyAdd1: rowFieldAny(ch, ['COMP_ADD1', 'comp_add1']),
    companyAdd2: rowFieldAny(ch, ['COMP_ADD2', 'comp_add2']),
    companyGst: rowFieldAny(ch, ['GST_NO', 'gst_no', 'comp_gst', 'gstin']),
    accountAdd1: rowFieldAny(acc, ['ADD1', 'add1']),
    accountAdd2: rowFieldAny(acc, ['ADD2', 'add2']),
    accountCity: rowFieldAny(acc, ['CITY', 'city']),
    accountGst: rowFieldAny(acc, ['GST_NO', 'gst_no']),
    accountPan: rowFieldAny(acc, ['PAN', 'pan']),
    accountTel: rowFieldAny(acc, ['TEL_NO_O', 'tel_no_o', 'TEL_NOO', 'tel_noo']),
  };
}

function formatAmtPdf(n, decimals = 2) {
  const v = parseFloat(n) || 0;
  const dec = Number.isFinite(decimals) ? decimals : 2;
  return v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function formatQtyPdf(n) {
  const v = parseFloat(n);
  if (Number.isNaN(v)) return '0';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function sbCell(row, u, l) {
  if (!row) return '';
  const x = row[u] ?? row[l];
  return x != null && x !== '' ? String(x) : '';
}

function normalizePrintImageSrc(raw, apiBase = '') {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s) || /^blob:/i.test(s)) return s;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 24) {
    return `data:image/png;base64,${s.replace(/\s+/g, '')}`;
  }
  if (/[./\\]/.test(s) || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(s)) {
    return `${apiBase || ''}/api/print-image?path=${encodeURIComponent(s)}`;
  }
  return '';
}

function cleanPrintText(raw) {
  if (raw == null) return '';
  return String(raw).trim();
}

/** Shared PDF shell (trial balance + ledger) */
const PDF_REPORT_STYLES = `
        .report-doc { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1a202c; font-size: 9px; line-height: 1.35; }
        .report-topbar {
          text-align: center;
          padding: 10px 12px 12px;
          border: 2px solid #1e3a5f;
          background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
          margin-bottom: 12px;
        }
        .report-topbar .kicker { font-size: 8px; letter-spacing: 0.2em; color: #475569; font-weight: 700; margin-bottom: 4px; }
        .report-topbar h1 {
          margin: 0 0 10px 0;
          font-size: 17px;
          font-weight: 800;
          color: #1e3a5f;
          letter-spacing: 0.06em;
          border-bottom: 2px solid #1e3a5f;
          padding-bottom: 8px;
        }
        .report-topbar .company { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 10px; }
        .report-grid {
          width: 100%;
          border-collapse: collapse;
          margin: 0 auto;
          max-width: 100%;
        }
        .report-grid td {
          border: 1px solid #94a3b8;
          padding: 5px 8px;
          vertical-align: middle;
        }
        .report-grid td.lbl {
          background: #cbd5e1;
          font-weight: 700;
          color: #1e293b;
          width: 18%;
          white-space: nowrap;
        }
        .report-grid td.val { background: #fff; font-weight: 600; }
        .report-period { font-size: 9px; color: #334155; margin-top: 8px; padding-top: 6px; border-top: 1px solid #94a3b8; }
        table.table-report {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #1e293b;
          margin: 0;
          table-layout: fixed;
          page-break-inside: auto;
          break-inside: auto;
        }
        table.table-report thead { display: table-header-group; }
        table.table-report tfoot { display: table-footer-group; }
        table.table-report tbody { display: table-row-group; }
        table.table-report thead th {
          background: #1e293b;
          color: #fff;
          font-size: 8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 7px 5px;
          border: 1px solid #0f172a;
          text-align: left;
        }
        table.table-report thead th.amount { text-align: right; }
        table.table-report tbody td {
          border: 1px solid #64748b;
          padding: 4px 5px;
          vertical-align: top;
          font-size: 8.5px;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        table.table-report tbody tr {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        table.table-report tbody tr:nth-child(odd) { background: #ffffff; }
        table.table-report tbody tr:nth-child(even) { background: #f1f5f9; }
        table.table-report tbody tr.subtotal-row td {
          background: #e0e7ff !important;
          font-weight: 700;
          color: #1e3a8a;
          border-top: 2px solid #6366f1;
          border-bottom: 1px solid #6366f1;
        }
        table.table-report tbody tr.broker-os-pdf-broker-total td {
          background: #3730a3 !important;
          color: #eef2ff !important;
          font-weight: 700;
          border-top: 2px solid #4f46e5;
        }
        table.table-report tbody tr.broker-os-pdf-bill-total td {
          background: #ecfeff !important;
          color: #0f172a !important;
          font-weight: 700;
          border-top: 1px solid #5eead4;
          border-bottom: 1px solid #99f6e4;
        }
        table.table-report tbody tr.broker-os-pdf-section-header td {
          background: #e0f2fe !important;
          color: #0c4a6e !important;
          font-weight: 800;
          font-size: 9px;
          border-top: 2px solid #38bdf8;
          border-bottom: 1px solid #7dd3fc;
          padding: 8px 6px;
        }
        table.table-report td.col-broker-os-pdf-detail {
          max-width: 150px;
          white-space: normal;
          word-wrap: break-word;
          font-size: 8px;
        }
        table.table-report tbody tr.op-row { background: #e0f2fe !important; }
        table.table-report tbody tr.sale-list-pdf-cn td {
          background: #ffedd5 !important;
          color: #7c2d12;
        }
        table.table-report tbody tr.sale-list-pdf-cn td:first-child {
          font-weight: 800;
          color: #c2410c;
        }
        table.table-report td.amount {
          text-align: right;
          font-family: Consolas, 'Courier New', monospace;
          white-space: nowrap;
        }
        table.table-report td.amount.bal { font-weight: 700; color: #0f766e; }
        table.table-report tr.report-grand-total td {
          border-top: 4px double #1e293b;
          border-left: 1px solid #1e293b;
          border-right: 1px solid #1e293b;
          border-bottom: 3px solid #1e293b;
          background: #1e3a5f !important;
          color: #fff !important;
          font-weight: 800;
          font-size: 9px;
          padding: 9px 6px;
          vertical-align: middle;
        }
        table.table-report tr.report-grand-total td.lbl-total {
          text-align: left;
          font-size: 10px;
          letter-spacing: 0.05em;
        }
        table.table-report tr.report-grand-total td.amount { color: #fff !important; font-size: 10px; }
        table.table-report td.amount.bill-ledger-interest-amt-pdf {
          color: #c2410c !important;
          font-weight: 800;
        }
        table.table-report tr.subtotal-row td.amount.bill-ledger-interest-amt-pdf {
          color: #9a3412 !important;
        }
        table.table-report tr.report-grand-total td.amount.bill-ledger-interest-amt-pdf {
          color: #fdba74 !important;
        }
        table.table-report td.amount.ageing-cur-bal-alert { color: #c53030 !important; font-weight: 700; }
        table.table-report tr.report-grand-total td.amount.ageing-cur-bal-alert { color: #fecaca !important; }
        .report-foot {
          margin-top: 10px;
          padding: 8px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          font-size: 8px;
          color: #64748b;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        table.table-report .col-sch { white-space: nowrap; width: 6%; }
        table.table-report .col-code { white-space: nowrap; width: 8%; }
        table.table-report .col-name { word-wrap: break-word; min-width: 120px; }
        table.table-report .col-city { word-wrap: break-word; width: 10%; }
        table.table-report .col-date { white-space: nowrap; width: 9%; }
        /* Wide purchase list: compact cells so html2canvas captures all columns on one page width */
        .purchase-list-pdf.report-doc { font-size: 7px; }
        .purchase-list-pdf table.table-report { table-layout: fixed; width: 100%; }
        .purchase-list-pdf table.table-report thead th {
          font-size: 5.5px;
          padding: 4px 2px;
          letter-spacing: 0;
          word-break: break-word;
          hyphens: auto;
        }
        .purchase-list-pdf table.table-report tbody td {
          font-size: 5.5px;
          padding: 2px 2px;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .purchase-list-pdf table.table-report td.amount {
          font-size: 5.5px;
          padding: 2px 2px;
        }
        .purchase-list-pdf table.table-report .col-name {
          min-width: 0;
          max-width: none;
        }
        .purchase-list-pdf { overflow: visible !important; max-width: none !important; width: 100%; }
        table.table-report .col-vr { width: 6%; white-space: nowrap; }
        table.table-report .col-type { width: 5%; white-space: nowrap; }
        table.table-report .col-detail { word-wrap: break-word; max-width: 220px; }
        table.table-report.bill-ledger-pdf-report { table-layout: fixed; }
        table.table-report.bill-ledger-pdf-report tbody td {
          font-size: 9.5px;
          padding: 4px 2px;
        }
        table.table-report.bill-ledger-pdf-report thead th.no-upper {
          text-transform: none;
          letter-spacing: 0.02em;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-bt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-bt,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-vt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-vt {
          text-align: center;
          padding: 3px 1px;
          white-space: nowrap;
          font-size: 8.5px;
          min-width: 0;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-date,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-date {
          white-space: nowrap;
          font-size: 8.5px;
          padding: 3px 2px;
          min-width: 0;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-bill-no,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-vr-no {
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap;
          font-size: 8.5px;
          padding: 3px 1px;
        }
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-bill-no,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-vr-no {
          white-space: nowrap;
          font-size: 8.5px;
          padding: 3px 1px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-int-days,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-int-days,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-int-amt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-int-amt,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-int-close,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-int-close {
          text-align: right;
          white-space: nowrap;
          min-width: 0;
          padding: 3px 2px;
          font-size: 8.5px;
          font-variant-numeric: tabular-nums;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-amt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-amt {
          text-align: right;
          padding: 3px 2px;
          font-size: 8.5px;
          font-family: Consolas, 'Courier New', monospace;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          min-width: 0;
        }
        table.table-report.bill-ledger-pdf-report thead th.col-bill-ledger-amt {
          font-size: 7px;
          padding: 5px 2px;
          white-space: normal;
          line-height: 1.2;
          vertical-align: bottom;
        }
        table.table-report.bill-ledger-pdf-report tr.subtotal-row td.col-bill-ledger-amt {
          font-size: 8.5px;
        }
        table.table-report.bill-ledger-pdf-report tr.report-grand-total td.col-bill-ledger-amt {
          font-size: 9px;
          padding: 6px 2px;
        }
        /* Ledger statement: narrow amount columns, more room for detail */
        table.table-report.table-report-ledger { table-layout: fixed; }
        table.table-report.table-report-ledger thead th {
          text-transform: none;
          letter-spacing: 0.02em;
          font-size: 10.4px;
          padding: 8px 4px;
        }
        table.table-report.table-report-ledger .col-detail {
          max-width: none;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
          font-size: 10.6px;
          line-height: 1.4;
        }
        table.table-report.table-report-ledger th.col-ledger-vr-date,
        table.table-report.table-report-ledger td.col-ledger-vr-date,
        table.table-report.table-report-ledger th.col-ledger-value-dt,
        table.table-report.table-report-ledger td.col-ledger-value-dt {
          white-space: nowrap;
          font-size: 9.6px;
        }
        table.table-report.table-report-ledger th.col-ledger-vr-no,
        table.table-report.table-report-ledger td.col-ledger-vr-no,
        table.table-report.table-report-ledger th.col-ledger-vr-type,
        table.table-report.table-report-ledger td.col-ledger-vr-type,
        table.table-report.table-report-ledger th.col-ledger-line-type,
        table.table-report.table-report-ledger td.col-ledger-line-type {
          white-space: nowrap;
          text-align: center;
          font-size: 9.4px;
          padding-left: 2px;
          padding-right: 2px;
        }
        table.table-report.table-report-ledger th.col-ledger-value-dt,
        table.table-report.table-report-ledger td.col-ledger-value-dt {
          width: auto;
          max-width: none;
        }
        table.table-report.table-report-ledger th.ledger-amt-col,
        table.table-report.table-report-ledger td.ledger-amt-col {
          width: auto;
          max-width: none;
          font-size: 10.2px;
          padding: 3px 4px;
          font-variant-numeric: tabular-nums;
        }
        table.table-report.table-report-ledger tbody td {
          font-size: 10.1px;
          padding-top: 5px;
          padding-bottom: 5px;
        }
        table.table-report.table-report-ledger td.ledger-cl-bal-pos {
          font-weight: 700;
          color: #0f766e;
        }
        table.table-report.table-report-ledger td.ledger-cl-bal-neg {
          font-weight: 700;
          color: #c53030 !important;
        }
        table.table-report tr.report-grand-total td.ledger-cl-bal-neg {
          color: #fecaca !important;
        }
        .report-grid td.val-ledger-acct-strong {
          text-align: left;
          font-weight: 700;
        }
        .report-grid td.ledger-party-line {
          text-align: left;
          font-weight: 700;
          font-size: 9px;
        }
        .ledger-pdf-company-block,
        .ledger-pdf-account-block {
          text-align: left;
          margin: 8px auto 0 auto;
          max-width: 100%;
          font-size: 10px;
          color: #0f172a;
        }
        .ledger-pdf-company-block {
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid #94a3b8;
        }
        .ledger-pdf-account-block {
          margin-bottom: 10px;
          font-weight: 600;
        }
        .ledger-pdf-block-title {
          font-size: 8.8px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #475569;
          margin-bottom: 4px;
          font-weight: 700;
        }
        .ledger-pdf-company-name {
          font-size: 12.4px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .ledger-pdf-line { margin: 2px 0; line-height: 1.42; }
`;

/** Trial balance PDF — same shell and grid lines as ledger */
function buildTrialBalanceReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const asOf = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const grouped = {};
  (data || []).forEach((row) => {
    const sch = row.SCHEDULE ?? row.schedule ?? 0;
    if (!grouped[sch]) grouped[sch] = [];
    grouped[sch].push(row);
  });

  const calculateTotals = (rows) => ({
    dr: rows.reduce((sum, r) => sum + parseFloat(r.DR_AMT ?? r.dr_amt ?? 0), 0),
    cr: rows.reduce((sum, r) => sum + parseFloat(r.CR_AMT ?? r.cr_amt ?? 0), 0),
    cdr: rows.reduce((sum, r) => sum + parseFloat(r.CLOSING_DR ?? r.closing_dr ?? 0), 0),
    ccr: rows.reduce((sum, r) => sum + parseFloat(r.CLOSING_CR ?? r.closing_cr ?? 0), 0),
  });

  let gdr = 0;
  let gcr = 0;
  let gcdr = 0;
  let gccr = 0;
  const sortedSchedules = Object.keys(grouped).sort((a, b) => parseFloat(a) - parseFloat(b));

  let bodyRows = '';
  sortedSchedules.forEach((sch) => {
    const rows = grouped[sch];
    const totals = calculateTotals(rows);
    gdr += totals.dr;
    gcr += totals.cr;
    gcdr += totals.cdr;
    gccr += totals.ccr;

    rows.forEach((row) => {
      const name = row.NAME ?? row.name ?? '';
      bodyRows += `
            <tr>
              <td class="col-sch">${escHtml(row.SCHEDULE ?? row.schedule ?? '')}</td>
              <td class="col-name">${escHtml(name)}</td>
              <td class="col-code">${escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-city">${escHtml(row.CITY ?? row.city ?? '—')}</td>
              <td class="amount">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount">${formatAmtPdf(row.CLOSING_DR ?? row.closing_dr)}</td>
              <td class="amount">${formatAmtPdf(row.CLOSING_CR ?? row.closing_cr)}</td>
            </tr>`;
    });

    bodyRows += `
            <tr class="subtotal-row">
              <td colspan="4" class="col-name"><strong>Schedule ${escHtml(sch)} — Subtotal</strong></td>
              <td class="amount"><strong>${formatAmtPdf(totals.dr)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(totals.cr)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(totals.cdr)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(totals.ccr)}</strong></td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>TRIAL BALANCE REPORT</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">As-of date</td><td class="val">${asOf}</td></tr>
        </table>
        <div class="report-period"><strong>Report basis:</strong> Balances as of date above &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report">
        <thead>
          <tr>
            <th>Sch</th>
            <th>Account name</th>
            <th>Code</th>
            <th>City</th>
            <th class="amount">Dr amt</th>
            <th class="amount">Cr amt</th>
            <th class="amount">Closing Dr</th>
            <th class="amount">Closing Cr</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="4" class="lbl-total">GRAND TOTAL</td>
            <td class="amount">${formatAmtPdf(gdr)}</td>
            <td class="amount">${formatAmtPdf(gcr)}</td>
            <td class="amount">${formatAmtPdf(gcdr)}</td>
            <td class="amount">${formatAmtPdf(gccr)}</td>
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Schedule subtotals follow each schedule block; grand total is across all schedules.
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

/** Trial balance summary — annexure totals only */
function buildTrialBalanceSummaryReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const asOf = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  let bodyRows = '';
  sortTrialBalanceRows(data || [])
    .filter((row) => trialBalanceRowKind(row) === 1 || trialBalanceRowKind(row) === 2)
    .forEach((row) => {
      const kind = trialBalanceRowKind(row);
      const isGrand = kind === 2;
      const nameVal = trialBalanceRowLabel(row);
      const schVal = row.SCHEDULE ?? row.schedule ?? '';
      const wrap = (amt) => (isGrand ? `<strong>${formatAmtPdf(amt)}</strong>` : formatAmtPdf(amt));
      bodyRows += `
            <tr class="${isGrand ? 'report-grand-total' : 'subtotal-row'}">
              <td class="col-sch">${escHtml(schVal)}</td>
              <td class="col-name">${isGrand ? `<strong>${escHtml(nameVal)}</strong>` : escHtml(nameVal)}</td>
              <td class="amount">${wrap(row.CLOSING_DR ?? row.closing_dr)}</td>
              <td class="amount">${wrap(row.CLOSING_CR ?? row.closing_cr)}</td>
              <td class="amount">${wrap(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount">${wrap(row.CR_AMT ?? row.cr_amt)}</td>
            </tr>`;
    });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>TRIAL BALANCE SUMMARY</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">As-of date</td><td class="val">${asOf}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>
      <table class="table-report table-report--trial-pdf">
        <thead>
          <tr>
            <th>Annexure</th>
            <th>Schedule name</th>
            <th class="amount">Cl.Dr.Amt</th>
            <th class="amount">Cl.Cr.Amt</th>
            <th class="amount">Tot.Dr.Amt</th>
            <th class="amount">Tot.Cr.Amt</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/** Trial balance date wise — opening / transactions / closing */
function buildTrialDateWiseReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const period = escHtml(metadata.endDate || metadata.periodLabel);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const num = (row, u, l) => parseFloat(row[u] ?? row[l] ?? 0) || 0;
  let bodyRows = '';

  sortTrialBalanceRows(data || [])
    .filter((row) => trialBalanceRowKind(row) !== 2)
    .forEach((row) => {
      const kind = trialBalanceRowKind(row);
      const isTotal = kind >= 1;
      const nameVal = trialBalanceRowLabel(row);
      const wrap = (v) => (isTotal ? `<strong>${formatAmtPdf(v)}</strong>` : formatAmtPdf(v));
      bodyRows += `
            <tr class="${kind === 1 ? 'subtotal-row' : ''}">
              <td>${isTotal ? '' : escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-name">${isTotal ? `<strong>${escHtml(nameVal)}</strong>` : escHtml(nameVal)}</td>
              <td>${isTotal ? '' : escHtml(row.CITY ?? row.city ?? '')}</td>
              <td>${isTotal ? '' : escHtml(row.PAN ?? row.pan ?? '')}</td>
              <td class="amount">${wrap(num(row, 'OP_DR', 'op_dr'))}</td>
              <td class="amount">${wrap(num(row, 'OP_CR', 'op_cr'))}</td>
              <td class="amount">${wrap(num(row, 'TRN_DR', 'trn_dr'))}</td>
              <td class="amount">${wrap(num(row, 'TRN_CR', 'trn_cr'))}</td>
              <td class="amount">${wrap(num(row, 'CL_DR', 'cl_dr'))}</td>
              <td class="amount">${wrap(num(row, 'CL_CR', 'cl_cr'))}</td>
            </tr>`;
    });

  const grand = findTrialGrandRow(data);
  if (grand) {
    bodyRows += `
            <tr class="report-grand-total">
              <td colspan="4"><strong>GRAND TOTAL</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'OP_DR', 'op_dr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'OP_CR', 'op_cr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'TRN_DR', 'trn_dr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'TRN_CR', 'trn_cr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'CL_DR', 'cl_dr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'CL_CR', 'cl_cr'))}</strong></td>
            </tr>`;
  }

  return `
    <div class="report-doc report-doc--trial-date-wise">
      <style>${PDF_REPORT_STYLES}
        .table-report--trial-date-wise { font-size: 7px; }
        .table-report--trial-date-wise th { font-size: 6.5px; padding: 3px 2px; }
        .table-report--trial-date-wise td { padding: 2px 2px; }
      </style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>TRIAL BALANCE DATE WISE</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>
      <table class="table-report table-report--trial-date-wise">
        <thead>
          <tr>
            <th rowspan="2">Code</th>
            <th rowspan="2">Name</th>
            <th rowspan="2">City</th>
            <th rowspan="2">Pan</th>
            <th colspan="2" class="amount">Opening Balance</th>
            <th colspan="2" class="amount">Transactions</th>
            <th colspan="2" class="amount">Closing Balance</th>
          </tr>
          <tr>
            <th class="amount">Debit</th>
            <th class="amount">Credit</th>
            <th class="amount">Debit</th>
            <th class="amount">Credit</th>
            <th class="amount">Debit</th>
            <th class="amount">Credit</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/** Ledger PDF table body (account header + grid + footer) — no outer report-doc shell. */
function buildLedgerPdfTableSection(rows, metadata, { includeAccountBlock = true } = {}) {
  const data = rows || [];
  let sumDr = 0;
  let sumCr = 0;
  data.forEach((row) => {
    sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
    sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
  });
  const last = data[data.length - 1];
  const closingBal =
    last != null
      ? parseFloat(last.CL_BALANCE ?? last.cl_balance ?? last.RUN_BAL ?? last.run_bal ?? 0) || 0
      : 0;

  const accName = escHtml(metadata.accountName);
  const accCode = escHtml(metadata.accountCode);
  const aAdd1 = escHtml(String(metadata.accountAdd1 ?? '').trim());
  const aAdd2 = escHtml(String(metadata.accountAdd2 ?? '').trim());
  const aCity = escHtml(String(metadata.accountCity ?? '').trim());
  const aGst = escHtml(String(metadata.accountGst ?? '').trim());
  const aPan = escHtml(String(metadata.accountPan ?? '').trim());
  const aTel = escHtml(String(metadata.accountTel ?? '').trim());

  const accMetaParts = [
    aCity ? `City: ${aCity}` : '',
    aGst ? `GST: ${aGst}` : '',
    aPan ? `PAN: ${aPan}` : '',
    aTel ? `Tel: ${aTel}` : '',
  ]
    .filter(Boolean)
    .join(' &nbsp;|&nbsp; ');
  const accountLines = [
    `<div><strong>${accName}</strong> (${accCode})</div>`,
    aAdd1 ? `<div class="ledger-pdf-line">${aAdd1}</div>` : '',
    aAdd2 ? `<div class="ledger-pdf-line">${aAdd2}</div>` : '',
    accMetaParts ? `<div class="ledger-pdf-line">${accMetaParts}</div>` : '',
  ]
    .filter(Boolean)
    .join('');
  const accountBlock = includeAccountBlock
    ? `<div class="ledger-pdf-account-block"><div class="ledger-pdf-block-title">Account</div>${accountLines}</div>`
    : '';

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const amountLen = (n) => formatAmtPdf(n).replace(/\s+/g, '').length;
  const maxAmtChars = Math.max(
    amountLen(sumDr),
    amountLen(sumCr),
    amountLen(closingBal),
    ...data.map((r) =>
      Math.max(
        amountLen(r.DR_AMT ?? r.dr_amt ?? 0),
        amountLen(r.CR_AMT ?? r.cr_amt ?? 0),
        amountLen(r.CL_BALANCE ?? r.cl_balance ?? r.RUN_BAL ?? r.run_bal ?? 0)
      )
    )
  );
  const maxDetailChars = Math.max(
    12,
    ...data.map((r) => String(r.DETAIL ?? r.detail ?? '').replace(/\s+/g, ' ').trim().length)
  );
  let amountColW = maxAmtChars >= 14 ? 11.5 : maxAmtChars >= 12 ? 11 : 10.5;
  const vrDateW = 7;
  const valueDateW = 7;
  const vrNoW = 5;
  const vrTypeW = 4.5;
  const typeW = 4.5;
  const fixedW = vrDateW + valueDateW + vrNoW + vrTypeW + typeW;
  let detailW = clamp(31 + Math.floor((maxDetailChars - 20) / 6), 31, 42);
  let total = fixedW + detailW + amountColW * 3;
  if (total > 100) {
    const overflow = total - 100;
    amountColW = clamp(amountColW - overflow / 3, 9.6, 12);
    total = fixedW + detailW + amountColW * 3;
  }
  if (total < 100) {
    detailW = clamp(detailW + (100 - total), 31, 44);
  }
  const ledgerColgroup = `
        <colgroup>
          <col style="width:${vrDateW.toFixed(2)}%" />
          <col style="width:${valueDateW.toFixed(2)}%" />
          <col style="width:${vrNoW.toFixed(2)}%" />
          <col style="width:${vrTypeW.toFixed(2)}%" />
          <col style="width:${typeW.toFixed(2)}%" />
          <col style="width:${detailW.toFixed(2)}%" />
          <col style="width:${amountColW.toFixed(2)}%" />
          <col style="width:${amountColW.toFixed(2)}%" />
          <col style="width:${amountColW.toFixed(2)}%" />
        </colgroup>`;

  let bodyRows = '';
  data.forEach((row) => {
    const vrType = row.VR_TYPE ?? row.vr_type ?? '';
    const opClass = vrType === 'OP' ? ' op-row' : '';
    const d = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    const vdRaw = row.V_DATE ?? row.v_date;
    const vdDisp = vdRaw != null && vdRaw !== '' ? formatLedgerDateDisplay(vdRaw) : '';
    const vd = escHtml(vdDisp || '—');
    const lineType = row.TYPE ?? row.type ?? '';
    const detail = escHtml(row.DETAIL ?? row.detail ?? '');
    const clBal = row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal;
    const clNum = parseFloat(clBal) || 0;
    const clCls = clNum < 0 ? 'ledger-cl-bal-neg' : 'ledger-cl-bal-pos';
    bodyRows += `
            <tr class="${opClass.trim()}">
              <td class="col-date col-ledger-vr-date">${d}</td>
              <td class="col-date col-ledger-value-dt">${vd}</td>
              <td class="col-vr col-ledger-vr-no">${escHtml(row.VR_NO ?? row.vr_no ?? '—')}</td>
              <td class="col-type col-ledger-vr-type">${escHtml(vrType)}</td>
              <td class="col-type col-ledger-line-type">${escHtml(lineType !== '' ? String(lineType) : '—')}</td>
              <td class="col-detail">${detail}</td>
              <td class="amount ledger-amt-col">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount ledger-amt-col">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount ledger-amt-col ${clCls}">${formatAmtPdf(clBal)}</td>
            </tr>`;
  });

  return `
      ${accountBlock}
      <table class="table-report table-report-ledger">
        ${ledgerColgroup}
        <thead>
          <tr>
            <th class="col-ledger-vr-date">Vr.Date</th>
            <th class="col-ledger-value-dt">Value Date</th>
            <th class="col-ledger-vr-no">Vr.No.</th>
            <th class="col-ledger-vr-type">Vr.Type</th>
            <th class="col-ledger-line-type">Type</th>
            <th>Detail</th>
            <th class="amount ledger-amt-col">Dr.Amount</th>
            <th class="amount ledger-amt-col">Cr.Amount</th>
            <th class="amount ledger-amt-col">Cl.Balance</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="6" class="lbl-total">GRAND TOTAL</td>
            <td class="amount ledger-amt-col">${formatAmtPdf(sumDr)}</td>
            <td class="amount ledger-amt-col">${formatAmtPdf(sumCr)}</td>
            <td class="amount ledger-amt-col ${closingBal < 0 ? 'ledger-cl-bal-neg' : ''}">${formatAmtPdf(closingBal)}</td>
          </tr>
        </tbody>
      </table>
      <div class="report-foot">
        Debit and credit columns are period totals; the balance column is the closing running balance.
      </div>`;
}

/** Ledger PDF */
function buildLedgerReportHtml(data, metadata) {
  const rows = data || [];
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const accCode = escHtml(metadata.accountCode);
  const period = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const cAdd1 = escHtml(String(metadata.companyAdd1 ?? '').trim());
  const cAdd2 = escHtml(String(metadata.companyAdd2 ?? '').trim());
  const cGst = escHtml(String(metadata.companyGst ?? '').trim());
  const companyLines = [
    company ? `<div class="ledger-pdf-company-name">${company}</div>` : '',
    cAdd1 ? `<div class="ledger-pdf-line">${cAdd1}</div>` : '',
    cAdd2 ? `<div class="ledger-pdf-line">${cAdd2}</div>` : '',
    cGst ? `<div class="ledger-pdf-line"><strong>GST:</strong> ${cGst}</div>` : '',
  ]
    .filter(Boolean)
    .join('');
  const companyBlock =
    companyLines !== '' ? `<div class="ledger-pdf-company-block">${companyLines}</div>` : '';

  const tableSection = buildLedgerPdfTableSection(rows, metadata);

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>LEDGER ACCOUNT STATEMENT</h1>
        ${companyBlock}
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Account code</td><td class="val">${accCode}</td></tr>
        </table>
        <div class="report-period"><strong>Period: ${period}</strong> &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>
      ${tableSection}
    </div>
  `;
}

const COMPLETE_LEDGER_PDF_W_PX = 794;
const COMPLETE_LEDGER_PDF_MARGIN_MM = 6;

function buildLedgerPdfCompanyBlockHtml(metadata) {
  const company = escHtml(metadata.companyName);
  const cAdd1 = escHtml(String(metadata.companyAdd1 ?? '').trim());
  const cAdd2 = escHtml(String(metadata.companyAdd2 ?? '').trim());
  const cGst = escHtml(String(metadata.companyGst ?? '').trim());
  const companyLines = [
    company ? `<div class="ledger-pdf-company-name">${company}</div>` : '',
    cAdd1 ? `<div class="ledger-pdf-line">${cAdd1}</div>` : '',
    cAdd2 ? `<div class="ledger-pdf-line">${cAdd2}</div>` : '',
    cGst ? `<div class="ledger-pdf-line"><strong>GST:</strong> ${cGst}</div>` : '',
  ]
    .filter(Boolean)
    .join('');
  return companyLines !== '' ? `<div class="ledger-pdf-company-block">${companyLines}</div>` : '';
}

function buildCompleteLedgerAccountMeta(sec, metadata) {
  const row0 = Array.isArray(sec?.rows) && sec.rows.length ? sec.rows[0] : null;
  return buildLedgerStatementPdfMetadata({
    formData: metadata?.formData,
    compLedgerHeader: metadata?.compLedgerHeader,
    account: {
      CODE: sec?.code,
      NAME: sec?.name,
      CITY: sec?.city,
      ADD1: sec?.add1,
      ADD2: sec?.add2,
      GST_NO: sec?.gst_no,
      PAN: sec?.pan,
      TEL_NO_O: sec?.tel_no_o,
      ...(row0 || {}),
    },
    year: metadata?.year,
    endDate: metadata?.endDate,
  });
}

function buildCompleteLedgerAccountTableHtml(rows, accountMeta) {
  const tableSection = buildLedgerPdfTableSection(rows, accountMeta, { includeAccountBlock: false });
  return `
    <div class="report-doc complete-ledger-pdf-root">
      <style>${PDF_REPORT_STYLES}</style>
      <style>
        .complete-ledger-pdf-root { width: ${COMPLETE_LEDGER_PDF_W_PX}px; max-width: ${COMPLETE_LEDGER_PDF_W_PX}px; background: #fff; color: #1a202c; }
      </style>
      ${tableSection}
    </div>
  `;
}

function pdfHeaderTextLines(pdf, text, maxW) {
  const t = String(text ?? '').trim();
  if (!t) return [];
  return pdf.splitTextToSize(t, maxW);
}

function drawLedgerPdfPageHeader(pdf, meta, startY = COMPLETE_LEDGER_PDF_MARGIN_MM) {
  const margin = COMPLETE_LEDGER_PDF_MARGIN_MM;
  const maxW = pdf.internal.pageSize.getWidth() - margin * 2;
  let y = startY;

  pdf.setTextColor(15, 23, 42);

  const company = String(meta.companyName || '').trim();
  if (company) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(company, margin, y);
    y += 5.2;
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  for (const line of [meta.companyAdd1, meta.companyAdd2].map((s) => String(s || '').trim()).filter(Boolean)) {
    for (const chunk of pdfHeaderTextLines(pdf, line, maxW)) {
      pdf.text(chunk, margin, y);
      y += 3.8;
    }
  }
  const cGst = String(meta.companyGst || '').trim();
  if (cGst) {
    pdf.text(`GST: ${cGst}`, margin, y);
    y += 3.8;
  }

  const accName = String(meta.accountName || '').trim();
  const accCode = String(meta.accountCode || '').trim();
  if (accName || accCode) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(`Account: ${accName}${accCode ? ` (${accCode})` : ''}`, margin, y);
    y += 4.5;
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  for (const line of [meta.accountAdd1, meta.accountAdd2].map((s) => String(s || '').trim()).filter(Boolean)) {
    for (const chunk of pdfHeaderTextLines(pdf, line, maxW)) {
      pdf.text(chunk, margin, y);
      y += 3.8;
    }
  }
  const accMeta = [
    meta.accountCity ? `City: ${meta.accountCity}` : '',
    meta.accountGst ? `GST: ${meta.accountGst}` : '',
    meta.accountPan ? `PAN: ${meta.accountPan}` : '',
    meta.accountTel ? `Tel: ${meta.accountTel}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');
  if (accMeta) {
    for (const chunk of pdfHeaderTextLines(pdf, accMeta, maxW)) {
      pdf.text(chunk, margin, y);
      y += 3.8;
    }
  }

  const period = String(meta.endDate || '').trim();
  const year = String(meta.year || '').trim();
  if (period) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text(`Period: ${period}${year ? `  |  FY ${year}` : ''}`, margin, y);
    y += 5;
  }

  pdf.setDrawColor(148, 163, 184);
  pdf.line(margin, y, pdf.internal.pageSize.getWidth() - margin, y);
  return y + 2;
}

function buildCompleteLedgerFilterBits(metadata) {
  return [
    metadata?.scheduleNo ? `Schedule ${escHtml(metadata.scheduleNo)}${metadata.scheduleLabel ? ` (${escHtml(metadata.scheduleLabel)})` : ''}` : '',
    metadata?.startCode != null && metadata?.endCode != null ? `Codes ${escHtml(metadata.startCode)}–${escHtml(metadata.endCode)}` : '',
    metadata?.accountCount != null ? `${escHtml(metadata.accountCount)} account(s)` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function buildCompleteLedgerSectionsHtml(sections, metadata) {
  return sections
    .map((sec, idx) => {
      const accountMeta = buildCompleteLedgerAccountMeta(sec, metadata);
      const breakCls = idx > 0 ? ' complete-ledger-pdf-section--break' : '';
      const inner = buildLedgerPdfTableSection(sec.rows, accountMeta);
      return `<div class="complete-ledger-pdf-section${breakCls}">${inner}</div>`;
    })
    .join('');
}

function buildCompleteLedgerCoverHtml(metadata, sectionCount) {
  const coverMeta = buildLedgerStatementPdfMetadata({
    formData: metadata?.formData,
    compLedgerHeader: metadata?.compLedgerHeader,
    account: {},
    year: metadata?.year,
    endDate: metadata?.endDate,
    accountNameOverride: '',
    accountCodeOverride: '',
  });
  const companyBlock = buildLedgerPdfCompanyBlockHtml({
    ...coverMeta,
    companyName: coverMeta.companyName || metadata?.companyName || metadata?.formData?.comp_name || metadata?.formData?.COMP_NAME || '',
  });
  const year = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.endDate || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const filterBits = buildCompleteLedgerFilterBits(metadata);

  return `
    <div class="report-doc complete-ledger-pdf-root">
      <style>${PDF_REPORT_STYLES}</style>
      <style>
        .complete-ledger-pdf-root { width: ${COMPLETE_LEDGER_PDF_W_PX}px; max-width: ${COMPLETE_LEDGER_PDF_W_PX}px; background: #fff; color: #1a202c; }
      </style>
      <div class="complete-ledger-pdf-cover">
        <div class="report-topbar">
          <div class="kicker">ACCOUNTING REPORT</div>
          <h1>COMPLETE LEDGER</h1>
          ${companyBlock}
          <table class="report-grid">
            <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Accounts</td><td class="val">${escHtml(sectionCount)}</td></tr>
          </table>
          <div class="report-period"><strong>Period: ${period}</strong>${filterBits ? ` &nbsp;|&nbsp; ${filterBits}` : ''}</div>
          <div class="report-period"><strong>Generated:</strong> ${generated}</div>
        </div>
      </div>
    </div>
  `;
}

function buildCompleteLedgerBodyHtml(sections, metadata) {
  const body = buildCompleteLedgerSectionsHtml(sections, metadata);
  return `
    <div class="report-doc complete-ledger-pdf-root">
      <style>${PDF_REPORT_STYLES}</style>
      <style>
        .complete-ledger-pdf-root { width: ${COMPLETE_LEDGER_PDF_W_PX}px; max-width: ${COMPLETE_LEDGER_PDF_W_PX}px; background: #fff; color: #1a202c; }
        .complete-ledger-pdf-section { margin-bottom: 12px; }
      </style>
      ${body}
    </div>
  `;
}

function buildCompleteLedgerReportHtml(data, metadata) {
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const company = escHtml(metadata?.companyName || metadata?.formData?.comp_name || metadata?.formData?.COMP_NAME || '');
  const year = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.endDate || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const filterBits = buildCompleteLedgerFilterBits(metadata);
  const body = buildCompleteLedgerSectionsHtml(sections, metadata);

  return `
    <div class="report-doc complete-ledger-pdf-root">
      <style>${PDF_REPORT_STYLES}</style>
      <style>
        .complete-ledger-pdf-root { width: ${COMPLETE_LEDGER_PDF_W_PX}px; max-width: ${COMPLETE_LEDGER_PDF_W_PX}px; background: #fff; color: #1a202c; }
        .complete-ledger-pdf-section { margin-bottom: 12px; }
        .complete-ledger-pdf-section--break { page-break-before: always; break-before: page; margin-top: 16px; }
        .complete-ledger-pdf-cover { page-break-after: always; break-after: page; margin-bottom: 12px; }
      </style>
      <div class="complete-ledger-pdf-cover">
        <div class="report-topbar">
          <div class="kicker">ACCOUNTING REPORT</div>
          <h1>COMPLETE LEDGER</h1>
          ${company ? `<div class="ledger-pdf-company-name">${company}</div>` : ''}
          <table class="report-grid">
            <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Accounts</td><td class="val">${escHtml(sections.length)}</td></tr>
          </table>
          <div class="report-period"><strong>Period: ${period}</strong>${filterBits ? ` &nbsp;|&nbsp; ${filterBits}` : ''}</div>
          <div class="report-period"><strong>Generated:</strong> ${generated}</div>
        </div>
      </div>
      ${body}
    </div>
  `;
}

function chunkCompleteLedgerSections(sections, maxRows = 180, maxAccounts = 10) {
  const chunks = [];
  let cur = [];
  let rows = 0;
  for (const sec of sections) {
    const n = Array.isArray(sec.rows) ? sec.rows.length : 0;
    if (cur.length && (rows + n > maxRows || cur.length >= maxAccounts)) {
      chunks.push(cur);
      cur = [];
      rows = 0;
    }
    cur.push(sec);
    rows += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

function mountCompleteLedgerPdfHost(html) {
  const host = document.createElement('div');
  host.setAttribute('data-pdf-host', 'complete-ledger');
  host.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${COMPLETE_LEDGER_PDF_W_PX}px`,
    'background:#fff',
    'color:#1a202c',
    'opacity:0.01',
    'pointer-events:none',
    'z-index:2147483646',
    'overflow:visible',
  ].join(';');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

async function waitForPdfPaint() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function captureCompleteLedgerPdfCanvas(host) {
  const target = host.querySelector('.report-doc') || host.firstElementChild || host;
  const canvas = await html2canvas(target, {
    scale: 1,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    width: COMPLETE_LEDGER_PDF_W_PX,
    windowWidth: COMPLETE_LEDGER_PDF_W_PX,
    scrollX: 0,
    scrollY: 0,
  });
  if (!canvas?.width || !canvas?.height) {
    throw new Error('PDF render produced empty canvas');
  }
  return canvas;
}

function appendCanvasSlicesToPdf(pdf, canvas, { newSection = true, pageHeader = null, headerEveryPage = false } = {}) {
  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const hadPages = pdf.internal.getNumberOfPages() > 0;
  const bottomMargin = COMPLETE_LEDGER_PDF_MARGIN_MM;

  let rendered = 0;
  while (rendered < imgH) {
    if (rendered > 0 || (hadPages && newSection)) {
      pdf.addPage();
    }

    let contentTop = 0;
    let sliceHeight = pageH - bottomMargin;
    if (pageHeader && headerEveryPage) {
      contentTop = drawLedgerPdfPageHeader(pdf, pageHeader, COMPLETE_LEDGER_PDF_MARGIN_MM);
      sliceHeight = pageH - contentTop - bottomMargin;
    }

    pdf.addImage(imgData, 'JPEG', 0, contentTop - rendered, imgW, imgH);
    rendered += sliceHeight > 0 ? sliceHeight : pageH - bottomMargin;
  }
}

async function getCompleteLedgerPdfBlob(data, metadata) {
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  if (!sections.length) {
    throw new Error('Complete ledger has no account sections to export.');
  }

  const options = getPdfOptions(metadata, 'complete-ledger');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const renderHtmlChunk = async (html, { isNewSection, pageHeader, headerEveryPage } = {}) => {
    const host = mountCompleteLedgerPdfHost(html);
    try {
      await waitForPdfPaint();
      const canvas = await captureCompleteLedgerPdfCanvas(host);
      appendCanvasSlicesToPdf(pdf, canvas, {
        newSection: isNewSection !== false,
        pageHeader,
        headerEveryPage: !!headerEveryPage,
      });
    } finally {
      document.body.removeChild(host);
    }
  };

  await renderHtmlChunk(buildCompleteLedgerCoverHtml(metadata, sections.length), { isNewSection: false });

  for (const sec of sections) {
    const accountMeta = buildCompleteLedgerAccountMeta(sec, metadata);
    const html = buildCompleteLedgerAccountTableHtml(sec.rows, accountMeta);
    await renderHtmlChunk(html, {
      isNewSection: true,
      pageHeader: accountMeta,
      headerEveryPage: true,
    });
  }

  return { blob: pdf.output('blob'), filename: options.filename };
}

/** Trading Ledger PDF (Entry/Date/Month wise). */
function buildTradingLedgerReportHtml(data, metadata) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || '');
  const year = escHtml(metadata.year || '');
  const title = escHtml(metadata.reportTitle || 'Trading Ledger');
  const period = escHtml(metadata.period || metadata.endDate || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const fmtDate = (v) => {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return raw;
  };
  const z = (n, qty = false) => {
    const v = parseFloat(n);
    if (!Number.isFinite(v) || v === 0) return '';
    return qty ? formatQtyPdf(v) : formatAmtPdf(v);
  };

  let sumRQ = 0; let sumRW = 0; let sumDR = 0;
  let sumSQ = 0; let sumSW = 0; let sumCR = 0;
  let lastBQ = 0; let lastBW = 0; let lastCL = 0;

  const bodyRows = rows.map((r) => {
    const rq = parseFloat(r.R_QNTY ?? r.r_qnty ?? 0) || 0;
    const rw = parseFloat(r.R_WEIGHT ?? r.r_weight ?? 0) || 0;
    const dr = parseFloat(r.DR_AMOUNT ?? r.dr_amount ?? r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    const sq = parseFloat(r.S_QNTY ?? r.s_qnty ?? 0) || 0;
    const sw = parseFloat(r.S_WEIGHT ?? r.s_weight ?? 0) || 0;
    const cr = parseFloat(r.CR_AMOUNT ?? r.cr_amount ?? r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    const bq = parseFloat(r.BAL_QNTY ?? r.bal_qnty ?? 0) || 0;
    const bw = parseFloat(r.BAL_WEIGHT ?? r.bal_weight ?? 0) || 0;
    const cl = parseFloat(r.CL_BALANCE ?? r.cl_balance ?? 0) || 0;
    sumRQ += rq; sumRW += rw; sumDR += dr; sumSQ += sq; sumSW += sw; sumCR += cr;
    lastBQ = bq; lastBW = bw; lastCL = cl;
    return `
      <tr>
        <td>${escHtml(String(r.VR_TYPE ?? r.vr_type ?? ''))}</td>
        <td>${escHtml(fmtDate(r.VR_DATE ?? r.vr_date))}</td>
        <td>${escHtml(String(r.VR_NO ?? r.vr_no ?? ''))}</td>
        <td>${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
        <td class="amount">${z(rq, true)}</td>
        <td class="amount">${z(rw, true)}</td>
        <td class="amount">${z(dr)}</td>
        <td class="amount">${z(sq, true)}</td>
        <td class="amount">${z(sw, true)}</td>
        <td class="amount">${z(cr)}</td>
        <td class="amount">${z(bq, true)}</td>
        <td class="amount">${z(bw, true)}</td>
        <td class="amount">${z(cl)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>${title}</h1>
        <table class="report-grid">
          <tr><td class="lbl">Company</td><td class="val">${company}</td><td class="lbl">Financial year</td><td class="val">${year}</td></tr>
        </table>
        <div class="report-period"><strong>Period:</strong> ${period} &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Vr.Type</th><th>Vr.Date</th><th>Vr.No</th><th>Type</th>
            <th class="amount">R.Qnty</th><th class="amount">R.Weight</th><th class="amount">Dr.Amount</th>
            <th class="amount">S.Qnty</th><th class="amount">S.Weight</th><th class="amount">Cr.Amount</th>
            <th class="amount">Bal.Qnty</th><th class="amount">Bal.Weight</th><th class="amount">Cl.Balance</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="4" class="lbl-total">GRAND TOTAL</td>
            <td class="amount">${z(sumRQ, true)}</td>
            <td class="amount">${z(sumRW, true)}</td>
            <td class="amount">${z(sumDR)}</td>
            <td class="amount">${z(sumSQ, true)}</td>
            <td class="amount">${z(sumSW, true)}</td>
            <td class="amount">${z(sumCR)}</td>
            <td class="amount">${z(lastBQ, true)}</td>
            <td class="amount">${z(lastBW, true)}</td>
            <td class="amount">${z(lastCL)}</td>
          </tr>
        </tbody>
      </table>
      <div class="report-foot">Trading Ledger export with quantity, weight and balance columns.</div>
    </div>
  `;
}

/** Bill-wise ledger PDF (BILLS, running balance per bill); optional GETINT columns */
function buildBillLedgerReportHtml(data, metadata) {
  const rows = data || [];
  const useInt = Boolean(metadata.billLedgerInterest);
  const ledgerTitle = escHtml(metadata.billLedgerTitle || 'CustomerLedger');
  const ledgerKind = String(metadata.billLedgerKind || 'customer').toLowerCase() === 'supplier' ? 'supplier' : 'customer';
  const billLedgerCrFirst = ledgerKind === 'supplier';
  let sumDr = 0;
  let sumCr = 0;
  let sumCurrent = 0;
  let sumInterest = 0;
  let sumClosePlusInt = 0;

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const partyNameRaw = String(metadata.partyName || '').trim();
  const partyCityRaw = String(metadata.partyCity ?? '').trim();
  const partyTelRaw = String(metadata.partyTel ?? '').trim();
  const partyParts = [partyNameRaw];
  if (partyCityRaw) partyParts.push(partyCityRaw);
  if (partyTelRaw) partyParts.push(`Tel: ${partyTelRaw}`);
  const party = escHtml(partyParts.join(' · '));
  const pcode = escHtml(metadata.partyCode);
  const period = escHtml(metadata.endDate);
  const payEnd = escHtml(metadata.payEndDate ?? '');
  const filt = escHtml(metadata.filterLabel ?? '');
  const intAsOf = escHtml(metadata.interestAsOfLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const billKeyOf = (row) => {
    const billNo = String(row.BILL_NO ?? row.bill_no ?? '').trim();
    const billDt = formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date);
    const bType = String(row.B_TYPE ?? row.b_type ?? '').trim();
    return `${billDt}__${billNo}__${bType}`;
  };

  const intHead = useInt
    ? '<th class="amount col-bill-ledger-int-days no-upper" title="Interest days">Days</th><th class="amount col-bill-ledger-int-amt no-upper">Int</th><th class="amount col-bill-ledger-int-close no-upper" title="Closing + interest">Cl+int</th>'
    : '';
  const intBlank = useInt
    ? '<td class="amount col-bill-ledger-int-days" style="opacity:.65">—</td><td class="amount col-bill-ledger-int-amt" style="opacity:.65">—</td><td class="amount col-bill-ledger-int-close" style="opacity:.65">—</td>'
    : '';

  let bodyRows = '';
  let billDr = 0;
  let billCr = 0;
  let billCurrent = 0;

  rows.forEach((row, idx) => {
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
    const cl = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? 0) || 0;
    sumDr += dr;
    sumCr += cr;
    billDr += dr;
    billCr += cr;
    billCurrent = cl;

    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const vrDt = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    const vDtRaw = row.V_DATE ?? row.v_date;
    const vDtEsc =
      vDtRaw != null && vDtRaw !== '' ? escHtml(formatLedgerDateDisplay(vDtRaw)) : '—';
    bodyRows += `
            <tr>
              <td class="col-vr col-bill-ledger-bill-no">${escHtml(row.BILL_NO ?? row.bill_no ?? '')}</td>
              <td class="col-date col-bill-ledger-date">${billDt}</td>
              <td class="col-type col-bill-ledger-bt">${escHtml(row.B_TYPE ?? row.b_type ?? '')}</td>
              <td class="col-date col-bill-ledger-date">${vrDt}</td>
              <td class="col-date col-bill-ledger-date">${vDtEsc}</td>
              <td class="col-vr col-bill-ledger-vr-no">${escHtml(row.VR_NO ?? row.vr_no ?? '')}</td>
              <td class="col-type col-bill-ledger-vt">${escHtml(row.VR_TYPE ?? row.vr_type ?? '')}</td>
              <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? row.CR_AMT ?? row.cr_amt : row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? row.DR_AMT ?? row.dr_amt : row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount col-bill-ledger-amt bal">${formatAmtPdf(row.CL_BALANCE ?? row.cl_balance)}</td>
              ${intBlank}
            </tr>`;

    const curKey = billKeyOf(row);
    const next = rows[idx + 1];
    const nextKey = next ? billKeyOf(next) : '';
    const billEnds = !next || curKey !== nextKey;
    if (!billEnds) return;

    const bt = escHtml(String(row.B_TYPE ?? row.b_type ?? ''));
    const bn = escHtml(String(row.BILL_NO ?? row.bill_no ?? ''));
    const intAmt = useInt ? parseFloat(row.INTEREST_AMT ?? row.interest_amt ?? '') || 0 : 0;
    const idays = useInt ? row.INTEREST_DAYS ?? row.interest_days : '';
    const idaysEsc = idays === '' || idays == null ? '—' : escHtml(String(idays));
    const closePlus = useInt ? billCurrent + intAmt : 0;
    if (useInt) {
      sumInterest += intAmt;
      sumClosePlusInt += closePlus;
    }
    const intCells = useInt
      ? `<td class="amount col-bill-ledger-int-days"><strong>${idaysEsc}</strong></td><td class="amount bill-ledger-interest-amt-pdf col-bill-ledger-int-amt"><strong>${formatAmtPdf(intAmt)}</strong></td><td class="amount col-bill-ledger-int-close"><strong>${formatAmtPdf(closePlus)}</strong></td>`
      : '';
    bodyRows += `
            <tr class="subtotal-row">
              <td colspan="7" class="col-name"><strong>Bill total — ${billDt} / ${bn} / ${bt}</strong></td>
              <td class="amount col-bill-ledger-amt"><strong>${formatAmtPdf(billLedgerCrFirst ? billCr : billDr)}</strong></td>
              <td class="amount col-bill-ledger-amt"><strong>${formatAmtPdf(billLedgerCrFirst ? billDr : billCr)}</strong></td>
              <td class="amount col-bill-ledger-amt"><strong>${formatAmtPdf(billCurrent)}</strong></td>
              ${intCells}
            </tr>`;
    sumCurrent += billCurrent;
    billDr = 0;
    billCr = 0;
    billCurrent = 0;
  });

  const intGrand = useInt
    ? `<td class="amount col-bill-ledger-int-days"><strong>—</strong></td><td class="amount bill-ledger-interest-amt-pdf col-bill-ledger-int-amt"><strong>${formatAmtPdf(sumInterest)}</strong></td><td class="amount col-bill-ledger-int-close"><strong>${formatAmtPdf(sumClosePlusInt)}</strong></td>`
    : '';
  const pdfColgroup = useInt
    ? `<colgroup>
            <col style="width:6.5%" /><col style="width:9.5%" /><col style="width:2.5%" /><col style="width:9.5%" /><col style="width:9.5%" />
            <col style="width:5.5%" /><col style="width:2.5%" />
            <col style="width:10%" /><col style="width:10%" /><col style="width:10%" />
            <col style="width:5%" /><col style="width:10%" /><col style="width:9.5%" />
          </colgroup>`
    : `<colgroup>
            <col style="width:10%" /><col style="width:14%" /><col style="width:3%" /><col style="width:14%" /><col style="width:14%" />
            <col style="width:8%" /><col style="width:4%" />
            <col style="width:11%" /><col style="width:11%" /><col style="width:11%" />
          </colgroup>`;
  const filterRowExtra = useInt
    ? `<tr><td class="lbl">Interest as of</td><td class="val" colspan="3">${intAsOf} (Oracle GETINT)</td></tr>`
    : '';

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>${ledgerTitle.toUpperCase()}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Party code</td><td class="val">${pcode}</td></tr>
          <tr><td class="lbl">Party name</td><td class="val" colspan="3">${party}</td></tr>
          <tr><td class="lbl">Bill date range</td><td class="val">${period}</td><td class="lbl">Payment ending</td><td class="val">${payEnd}</td></tr>
          <tr><td class="lbl">Filter</td><td class="val" colspan="3">${filt} (${ledgerKind === 'supplier' ? 'CR - DR' : 'DR - CR'})</td></tr>
          ${filterRowExtra}
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report bill-ledger-pdf-report">
        ${pdfColgroup}
        <thead>
          <tr>
            <th class="col-bill-ledger-bill-no no-upper">Bill no</th>
            <th class="col-bill-ledger-date no-upper">Bill date</th>
            <th class="col-bill-ledger-bt no-upper">BT</th>
            <th class="col-bill-ledger-date no-upper">Vr date</th>
            <th class="col-bill-ledger-date no-upper">V date</th>
            <th class="col-bill-ledger-vr-no no-upper">Vr no</th>
            <th class="col-bill-ledger-vt no-upper">VT</th>
            <th class="amount col-bill-ledger-amt no-upper">${billLedgerCrFirst ? 'Cr.Amount' : 'Dr.Amount'}</th>
            <th class="amount col-bill-ledger-amt no-upper">${billLedgerCrFirst ? 'Dr.Amount' : 'Cr.Amount'}</th>
            <th class="amount col-bill-ledger-amt no-upper">Closing Bal.</th>
            ${intHead}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="7" class="lbl-total">GRAND TOTAL <span style="font-weight:600;opacity:.9">(Dr/Cr sums + current bal total${useInt ? '; interest from GETINT' : ''})</span></td>
            <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? sumCr : sumDr)}</td>
            <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? sumDr : sumCr)}</td>
            <td class="amount col-bill-ledger-amt">${formatAmtPdf(sumCurrent)}</td>
            ${intGrand}
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Current balance is shown per line and per bill total (Bill date + Bill no + B type), with a final grand total.
        <br />
        Balance formula: ${ledgerKind === 'supplier' ? 'CR - DR' : 'DR - CR'}.
        ${useInt ? `<br />Interest columns use Oracle ${ledgerKind === 'supplier' ? 'GETINT_SUP' : 'GETINT'} logic (legacy VFP9-compatible).` : ''}
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

/** Broker-wise outstanding PDF */
function buildBrokerOsReportHtml(data, metadata) {
  const { displayRows, grandDr, grandCr } = buildBrokerOsDisplayRows(data || []);

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const period = escHtml(metadata.endDate);
  const payEnd = escHtml(metadata.payEndDate ?? '');
  const brokerHead = escHtml(metadata.brokerHead ?? metadata.brokerRange ?? '');
  const party = escHtml(metadata.partyLabel ?? '');
  const filt = escHtml(metadata.filterLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let bodyRows = '';
  displayRows.forEach((item) => {
    if (item.kind === 'broker-section-header' || item.kind === 'broker-header') {
      const hc = escHtml(item.BK_CODE ?? item.B_CODE ?? '');
      const hn = escHtml(String(item.BK_NAME ?? item.bk_name ?? '').trim());
      const headLine = hn ? `Broker ${hc} — ${hn}` : `Broker ${hc}`;
      bodyRows += `
            <tr class="broker-os-pdf-section-header">
              <td colspan="12" class="col-name"><strong>${headLine}</strong></td>
            </tr>`;
      return;
    }
    if (item.kind === 'bill-total') {
      const code = escHtml(item.CODE ?? '');
      const billDt = escHtml(formatLedgerDateDisplay(item.BILL_DATE ?? item.bill_date));
      const billNo = escHtml(item.BILL_NO ?? '');
      const bType = escHtml(item.B_TYPE ?? item.b_type ?? '');
      bodyRows += `
            <tr class="broker-os-pdf-bill-total">
              <td colspan="8" class="col-name"><strong>Bill total — ${code} / ${billDt} / ${billNo} / ${bType}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount">—</td>
              <td class="amount"><strong>${formatAmtPdf(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong></td>
            </tr>`;
      return;
    }
    if (item.kind === 'party-total') {
      const label = escHtml(`Party total — ${item.NAME || '—'} (${item.CODE})`);
      bodyRows += `
            <tr class="subtotal-row">
              <td colspan="8" class="col-name"><strong>${label}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount">—</td>
              <td class="amount">—</td>
            </tr>`;
      return;
    }
    if (item.kind === 'broker-total') {
      const bk = escHtml(item.BK_CODE ?? item.B_CODE ?? '');
      const bkNm = String(item.BK_NAME ?? item.bk_name ?? '').trim();
      const brokerPdfLabel = bkNm ? `${bk} — ${escHtml(bkNm)}` : bk;
      bodyRows += `
            <tr class="broker-os-pdf-broker-total">
              <td colspan="8" class="col-name"><strong>Broker total — ${brokerPdfLabel}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount">—</td>
              <td class="amount">—</td>
            </tr>`;
      return;
    }
    if (item.kind !== 'detail' || !item.row) return;
    const row = item.row;
    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const vrDt = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    const det = escHtml(String(row.DETAIL ?? row.detail ?? '').trim());
    bodyRows += `
            <tr>
              <td class="col-code">${escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-name">${escHtml(row.NAME ?? row.name ?? '')}</td>
              <td class="col-vr">${escHtml(row.BILL_NO ?? row.bill_no ?? '')}</td>
              <td class="col-date">${billDt}</td>
              <td class="col-type">${escHtml(row.VR_TYPE ?? row.vr_type ?? '')}</td>
              <td class="col-date">${vrDt}</td>
              <td class="col-vr">${escHtml(row.VR_NO ?? row.vr_no ?? '')}</td>
              <td class="col-name col-broker-os-pdf-detail">${det || '—'}</td>
              <td class="amount">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount bal">${formatAmtPdf(row.RUN_BAL ?? row.run_bal)}</td>
              <td class="amount">${formatAmtPdf(row.FINAL_BAL ?? row.final_bal)}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>BROKER-WISE OUTSTANDING</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Broker</td><td class="val">${brokerHead}</td></tr>
          <tr><td class="lbl">Party filter</td><td class="val" colspan="3">${party}</td></tr>
          <tr><td class="lbl">Bill dates</td><td class="val">${period}</td><td class="lbl">Payment ending</td><td class="val">${payEnd}</td></tr>
          <tr><td class="lbl">Filter</td><td class="val" colspan="3">${filt}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report">
        <thead>
          <tr>
            <th>Code</th>
            <th>Party</th>
            <th>Bill</th>
            <th>Bill dt</th>
            <th>Vr typ</th>
            <th>Vr dt</th>
            <th>Vr no</th>
            <th>Detail</th>
            <th class="amount">Dr</th>
            <th class="amount">Cr</th>
            <th class="amount">Run</th>
            <th class="amount">Final</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="8" class="lbl-total">GRAND TOTAL (all detail lines)</td>
            <td class="amount">${formatAmtPdf(grandDr)}</td>
            <td class="amount">${formatAmtPdf(grandCr)}</td>
            <td class="amount">—</td>
            <td class="amount">—</td>
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Grouped by broker, then party name (A–Z) and code. Party and broker subtotals precede each group close. Bills included only when BILLS has BK_CODE in range with VR_TYPE SL, SE, or PU. Credits after payment ending date count as zero.
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

function buildAgeingReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year ?? '');
  const schedule = escHtml(metadata.schedule ?? '');
  const scheduleRaw = metadata.schedule;
  const endingDate = escHtml(metadata.endingDate ?? '');
  const modeLabel = escHtml(metadata.modeLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const labels = Array.isArray(metadata.rangeLabels) && metadata.rangeLabels.length === 5
    ? metadata.rangeLabels
    : ['0 to 30', '31 to 60', '61 to 90', '91 to 180', '181 to 99999'];

  let curBalDisplayed = 0;
  let curBalRaw = 0;
  const totals = [0, 0, 0, 0, 0];
  let bodyRows = '';
  (data || []).forEach((row) => {
    const rawBal = Number(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
    const { display, alert } = ageingCurBalDisplay(scheduleRaw, rawBal);
    curBalDisplayed += display;
    curBalRaw += rawBal;
    const curCellClass = alert ? 'amount ageing-cur-bal-alert' : 'amount';
    const bucketCells = labels
      .map((_, idx) => {
        const value = Number(row[`RANGE_${idx + 1}`] ?? row[`range_${idx + 1}`] ?? 0) || 0;
        totals[idx] += value;
        return `<td class="amount">${formatAmtPdf(value)}</td>`;
      })
      .join('');
    bodyRows += `
          <tr>
            <td class="col-code">${escHtml(row.CODE ?? row.code ?? '')}</td>
            <td class="col-name">${escHtml(row.NAME ?? row.name ?? '')}</td>
            <td>${escHtml(row.CITY ?? row.city ?? '')}</td>
            <td class="${curCellClass}"><strong>${formatAmtPdf(display)}</strong></td>
            ${bucketCells}
          </tr>`;
  });
  const totalCurAlert = ageingCurBalDisplay(scheduleRaw, curBalRaw).alert;
  const grandCurClass = totalCurAlert ? 'amount ageing-cur-bal-alert' : 'amount';

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>AGEING REPORT</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Schedule</td><td class="val">${schedule}</td></tr>
          <tr><td class="lbl">Ending date</td><td class="val">${endingDate}</td><td class="lbl">Source</td><td class="val">${modeLabel}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>City</th>
            <th class="amount">Cur. Bal</th>
            ${labels.map((label) => `<th class="amount">${escHtml(label)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="3" class="lbl-total">GRAND TOTAL</td>
            <td class="${grandCurClass}">${formatAmtPdf(curBalDisplayed)}</td>
            ${totals.map((value) => `<td class="amount">${formatAmtPdf(value)}</td>`).join('')}
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Ageing buckets are based on residual FIFO balance in Ledger mode and grouped outstanding bill balance in Bills mode.
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

/** Sale list PDF (landscape): day totals (qty, wt, amt, bill amt), grand total, then item-wise summary */
function buildSaleListReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const period = escHtml(metadata.endDate ?? '');
  const party = escHtml(metadata.partyLabel ?? '');
  const broker = escHtml(metadata.brokerLabel ?? '');
  const item = escHtml(metadata.itemLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const { displayRows } = buildSaleListDisplayRows(data);
  const C = 18;

  let body = '';
  displayRows.forEach((item) => {
    if (item.kind === 'day-header') {
      body += `<tr class="sale-list-pdf-banner"><td colspan="${C}"><strong>Day — ${escHtml(item.dateLabel)}</strong></td></tr>`;
      return;
    }
    if (item.kind === 'day-total') {
      body += `<tr class="sale-list-pdf-subtotal">
            <td colspan="8"><strong>Day total</strong> — ${escHtml(item.dateLabel)}</td>
            <td class="amount"><strong>${formatAmtPdf(item.qnty)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.weight)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.amount)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.taxable)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.cgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.sgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.igstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.billAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.disAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.othExp5)}</strong></td>
          </tr>`;
      return;
    }
    if (item.kind === 'section-label') {
      body += `<tr class="sale-list-pdf-section"><td colspan="${C}"><strong>${escHtml(item.label)}</strong></td></tr>`;
      return;
    }
    if (item.kind === 'item-col-head') {
      body += `<tr class="sale-list-pdf-item-head">
            <th>Item code</th>
            <th class="col-name">Item name</th>
            <th class="amount">Qty</th>
            <th class="amount">Weight</th>
            <th class="amount">Amount</th>
            <td colspan="13"></td>
          </tr>`;
      return;
    }
    if (item.kind === 'grand-item') {
      body += `<tr class="sale-list-pdf-itemsum">
            <td>${escHtml(item.code && item.code !== '—' ? item.code : '—')}</td>
            <td class="col-name">${escHtml(item.name)}</td>
            <td class="amount">${formatAmtPdf(item.qnty)}</td>
            <td class="amount">${formatAmtPdf(item.weight)}</td>
            <td class="amount">${formatAmtPdf(item.amount)}</td>
            <td colspan="13">—</td>
          </tr>`;
      return;
    }
    if (item.kind === 'grand-total') {
      body += `<tr class="sale-list-pdf-grand">
            <td colspan="8"><strong>Grand total</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.qnty)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.weight)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.amount)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.taxable)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.cgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.sgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.igstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.billAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.disAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.othExp5)}</strong></td>
          </tr>`;
      return;
    }
    const row = item.row;
    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const typRaw = String(row.TYPE ?? row.type ?? '').trim().toUpperCase();
    const cnClass = typRaw === 'CN' ? ' class="sale-list-pdf-cn"' : '';
    body += `
            <tr${cnClass}>
              <td>${escHtml(row.TYPE ?? row.type)}</td>
              <td>${billDt}</td>
              <td>${escHtml(row.BILL_NO ?? row.bill_no)}</td>
              <td>${escHtml(row.CODE ?? row.code)}</td>
              <td class="col-name">${escHtml(row.NAME ?? row.name)}</td>
              <td>${escHtml(row.BK_CODE ?? row.bk_code)}</td>
              <td>${escHtml(row.ITEM_CODE ?? row.item_code)}</td>
              <td class="col-name">${escHtml(row.ITEM_NAME ?? row.item_name)}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'QNTY', 'qnty'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'WEIGHT', 'weight'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'AMOUNT', 'amount'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'TAXABLE', 'taxable'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'CGST_AMT', 'cgst_amt'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'SGST_AMT', 'sgst_amt'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'IGST_AMT', 'igst_amt'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'BILL_AMT', 'bill_amt'))}</td>
              <td class="amount">${formatAmtPdf(row.DIS_AMT ?? row.dis_amt)}</td>
              <td class="amount">${formatAmtPdf(row.OTH_EXP5 ?? row.oth_exp5)}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">SALE LIST</div>
        <h1>Sale list (SL / SE / CN)</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          FY <strong>${year}</strong> · Period <strong>${period}</strong><br />
          Party: ${party} · Broker: ${broker} · Item: ${item}<br />
          Generated: ${generated}
        </div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Type</th>
            <th>Bill date</th>
            <th>Bill no</th>
            <th>Code</th>
            <th>Name</th>
            <th>Bk</th>
            <th>Item</th>
            <th>Item name</th>
            <th class="amount">Qty</th>
            <th class="amount">Wt</th>
            <th class="amount">Amount</th>
            <th class="amount">Taxable</th>
            <th class="amount">CGST</th>
            <th class="amount">SGST</th>
            <th class="amount">IGST</th>
            <th class="amount">Bill amt</th>
            <th class="amount">Dis amt</th>
            <th class="amount">Round off</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <div class="report-foot">Item-wise summary: columns Item code, Item name, Qty, Weight, Amount (full period). Final row is grand total. Bill amount on lines may repeat per bill.</div>
    </div>
  `;
}

const SALE_BILL_PDF_STYLES = `
  .sb-pdf { font-size: 8px; line-height: 1.35; }
  .sb-pdf.sb-pdf-bos { font-size: 9px; line-height: 1.45; }
  .sb-pdf-top { display: grid; grid-template-columns: 132px 1fr 132px; align-items: flex-start; gap: 10px; margin-bottom: 10px; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; }
  .sb-pdf-logo { flex-shrink: 0; width: 132px; }
  .sb-pdf-logo img { width: 132px; height: 132px; object-fit: contain; display: block; }
  .sb-pdf-logo--empty { min-height: 132px; }
  .sb-pdf-top-main { width: 100%; max-width: 410px; margin: 0 auto; text-align: center; min-width: 0; }
  .sb-pdf-top-right { flex-shrink: 0; width: 132px; text-align: right; }
  .sb-pdf-top-right--empty { min-height: 132px; }
  .sb-pdf-title { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; margin-bottom: 6px; color: #0f172a; }
  .sb-pdf.sb-pdf-bos .sb-pdf-title { font-size: 12px; }
  .sb-pdf-co { font-size: 22px; font-weight: 700; margin-bottom: 4px; color: #0047ab; }
  .sb-pdf.sb-pdf-bos .sb-pdf-co { font-size: 24px; color: #0047ab; }
  .sb-pdf-co { white-space: nowrap; display: block; width: 100%; }
  .sb-pdf-addr { font-size: 8px; color: #334155; }
  .sb-pdf-qr { flex-shrink: 0; width: 132px; }
  .sb-pdf-qr img { width: 132px; height: 132px; object-fit: contain; display: block; }
  .sb-pdf-inv { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 0; }
  .sb-pdf-inv-cn-sub { margin-top: 2px; padding-top: 4px; border-top: 1px dashed #94a3b8; }
  .sb-pdf-inv-cn-sub--3 { grid-template-columns: 1fr 1fr 1fr; }
  .sb-pdf-inv-item { display: block; font-size: 10.5px; font-weight: 700; }
  .sb-pdf-inv-item strong { font-weight: 800; }
  .sb-pdf-inv-rule { border: none; border-top: 2px solid #1e3a5f; margin: 3px 0 6px; }
  .sb-pdf-irn { font-size: 7.5px; color: #334155; margin-bottom: 8px; word-break: break-all; }
  .sb-pdf-two { display: table; width: 100%; border: 1px solid #94a3b8; margin-bottom: 8px; }
  .sb-pdf-two > div { display: table-cell; width: 50%; padding: 6px 8px; vertical-align: top; border-right: 1px solid #cbd5e1; }
  .sb-pdf-two.sb-pdf-three > div { width: 33.33%; }
  .sb-pdf-two > div:last-child { border-right: none; }
  .sb-pdf-h { font-weight: 700; color: #1e3a5f; margin-bottom: 4px; }
  .sb-pdf-broker { margin-bottom: 6px; font-size: 8px; }
  table.sb-pdf-grid { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 7px; }
  table.sb-pdf-grid.sb-pdf-grid-bos { font-size: 8.5px; }
  table.sb-pdf-grid th, table.sb-pdf-grid td { border: 1px solid #64748b; padding: 3px 4px; vertical-align: top; }
  table.sb-pdf-grid th { background: #e2e8f0; font-weight: 700; }
  table.sb-pdf-grid td.num { text-align: right; white-space: nowrap; font-family: Consolas, monospace; }
  table.sb-pdf-sum { width: 220px; margin-left: auto; border-collapse: collapse; font-size: 8px; margin-bottom: 0; }
  .sb-pdf.sb-pdf-bos table.sb-pdf-sum { font-size: 9px; }
  table.sb-pdf-sum td { border: 1px solid #64748b; padding: 4px 6px; }
  table.sb-pdf-sum td.num { text-align: right; }
  .sb-pdf-net-words-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; width: 220px; margin-left: auto; border: 1px solid #64748b; border-top: none; padding: 4px 6px; background: #f1f5f9; font-size: 7.5px; line-height: 1.35; box-sizing: border-box; }
  .sb-pdf.sb-pdf-bos .sb-pdf-net-words-row { font-size: 8.5px; }
  .sb-pdf-words-inline { flex: 1; min-width: 0; }
  .sb-pdf-net-amount { flex-shrink: 0; text-align: right; }
  .sb-pdf-sum-row { display: grid; grid-template-columns: 1fr 220px; width: 100%; align-items: start; gap: 8px; }
  .sb-pdf-sum-main { width: 220px; }
  .sb-pdf-sum-main table.sb-pdf-sum { width: 100%; margin-left: 0; }
  .sb-pdf-sum-main .sb-pdf-net-words-row { width: 100%; margin-left: 0; }
  .sb-pdf-total-side { min-height: 132px; display: flex; align-items: flex-start; justify-content: center; }
  .sb-pdf-total-side-left { justify-content: flex-start; }
  .sb-pdf-total-side--empty { min-height: 132px; }
  .sb-pdf-total-side-left.sb-pdf-total-side--empty { display: none; }
  .sb-pdf-logo2 img { width: 132px; height: 132px; object-fit: contain; display: block; }
  .sb-pdf-footer-rule { border: none; border-top: 1px solid #64748b; margin: 6px 0 5px; }
  .sb-pdf-bank { margin-bottom: 6px; font-size: 7.5px; line-height: 1.35; color: #334155; }
  .sb-pdf-transport { font-size: 7.5px; line-height: 1.35; color: #334155; margin-bottom: 8px; }
  .sb-pdf-transport span { margin-right: 10px; }
  .sb-pdf-terms { margin-bottom: 8px; font-size: 7.5px; line-height: 1.35; color: #334155; }
  .sb-pdf-bottom { display: table; width: 100%; margin-top: 6px; }
  .sb-pdf-bottom-left, .sb-pdf-bottom-right { display: table-cell; vertical-align: top; }
  .sb-pdf-bottom-left { width: 65%; }
  .sb-pdf-bottom-right { width: 35%; text-align: right; }
  .sb-pdf-sign { text-align: right; margin-top: 0; font-size: 8px; }
  .sb-pdf-signature { margin-top: 8px; }
  .sb-pdf-signature img { max-width: 130px; max-height: 65px; object-fit: contain; }
  .sb-pdf-auth { margin-top: 4px; color: #475569; }
  .sb-pdf-party-name { font-weight: 700; }
`;

/** Sale bill / tax invoice PDF (portrait) */
function buildSaleBillReportHtml(data, metadata) {
  const { lines, header, first, docTitle, totals, qrDataUrl } = data;
  const h = header || {};
  const f = first || {};
  const apiBase = String(metadata?.apiBase || '').trim();
  const companyRaw = String(metadata.companyName || '').trim();
  const company = escHtml(companyRaw || 'Company');
  const fv = (logical) => {
    const raw = rowFieldCI(f, logical);
    return raw ? escHtml(raw) : '';
  };

  const saleInv = escHtml(rowFieldCI(f, 'sale_inv_no') || '—');
  const billDt = escHtml(formatLedgerDateDisplay(f.BILL_DATE ?? f.bill_date ?? rowFieldCI(f, 'bill_date')));
  const t = totals || {};
  const taxLabel = (name, perRaw) => {
    const per = Number(perRaw);
    if (!Number.isFinite(per) || Math.abs(per) < 0.0001) return name;
    const clean = Number.isInteger(per) ? String(per) : per.toFixed(2).replace(/\.?0+$/, '');
    return `${name} (${clean}%)`;
  };
  const cgstLabel = taxLabel('CGST', rowFieldCI(f, 'cgst_per'));
  const sgstLabel = taxLabel('SGST', rowFieldCI(f, 'sgst_per'));
  const igstLabel = taxLabel('IGST', rowFieldCI(f, 'igst_per'));
  const taxSumPdf = Math.abs(Number(t.sumC || 0)) + Math.abs(Number(t.sumS || 0)) + Math.abs(Number(t.sumI || 0));
  const docUpper = String(docTitle || '').toUpperCase();
  const isCreditNotePdf = docUpper === 'CREDIT NOTE';
  const cnBillNoEsc = escHtml(rowFieldCI(f, 'bill_no') || '—');
  const sbNoEsc = escHtml(rowFieldAny(f, ['sb_no', 'SB_NO']) || '—');
  const sbTypeEsc = escHtml(rowFieldAny(f, ['sb_type', 'SB_TYPE']) || '—');
  const sbDateEsc = escHtml(formatLedgerDateDisplay(f.SB_DATE ?? f.sb_date) || '—');
  const isBillOfSupplyNoTax =
    taxSumPdf < 0.0001 && (docUpper === 'BILL OF SUPPLY' || docUpper === 'CREDIT NOTE');
  /** Line-level discount column only when CGST+SGST+IGST ≠ 0; else discount only in summary after total amount. */
  const showDiscountColPdf = !isBillOfSupplyNoTax;
  const askGrossDane = String(metadata?.printGrossDane || '').trim().toUpperCase();
  const askPacking = String(metadata?.printPacking || '').trim().toUpperCase();
  const printGWeightDefaultPdf =
    String(rowFieldCI(f, 'print_g_weight') || rowFieldCI(f, 'g_weight') || '')
      .trim()
      .toUpperCase() === 'Y';
  const printGWeightPdf = askGrossDane === 'Y' ? true : askGrossDane === 'N' ? false : printGWeightDefaultPdf;
  const printPackingDefaultPdf = String(rowFieldCI(f, 'print_packing') || '').trim().toUpperCase() === 'Y';
  const printPackingPdf = askPacking === 'Y' ? true : askPacking === 'N' ? false : printPackingDefaultPdf || printGWeightPdf;
  const gWgtKqPdf = String(rowFieldCI(f, 'wgt_k_q') || 'K').trim().toUpperCase() || 'K';
  const gWeightHeaderPdf = escHtml(
    String(rowFieldCI(f, 'g_weight_header') || (gWgtKqPdf === 'K' ? 'In Kg.' : 'In Qtl.')).trim()
  );
  const dWeightHeaderPdf = escHtml(String(rowFieldCI(f, 'd_weight_header') || (gWgtKqPdf === 'K' ? 'In Kg.' : 'In Qtl.')).trim());
  const rateHeaderPdf = escHtml(String(rowFieldCI(f, 'g_rate_header') || 'In Qtl.').trim());
  const companyNameBasePx = isBillOfSupplyNoTax ? 24 : 22;
  const companyNameFontPx = (() => {
    const len = companyRaw.length;
    if (len <= 22) return companyNameBasePx;
    const reduced = companyNameBasePx - (len - 22) * 0.45;
    return Math.max(13, Math.round(reduced * 100) / 100);
  })();

  const qds = qrDataUrl ? String(qrDataUrl) : '';
  const qrSafe =
    qds && (/^https?:\/\//i.test(qds) || qds.startsWith('data:image/')) ? qds : '';
  const qrHtml = qrSafe ? `<div class="sb-pdf-qr"><img src="${qrSafe}" alt="" /></div>` : '';
  const logoSafe = normalizePrintImageSrc(
    rowFieldCI(f, 'sale_logo') || rowFieldCI(h, 'sale_logo'),
    apiBase
  );
  const logoHtml = logoSafe ? `<div class="sb-pdf-logo"><img src="${logoSafe}" alt="" /></div>` : '<div class="sb-pdf-logo sb-pdf-logo--empty"></div>';
  const logo2Safe = normalizePrintImageSrc(
    rowFieldCI(f, 'sale_logo2') || rowFieldCI(h, 'sale_logo2'),
    apiBase
  );
  const signatureSafe = normalizePrintImageSrc(
    rowFieldCI(f, 'signature_file') || rowFieldCI(h, 'signature_file'),
    apiBase
  );
  const signatureHtml = signatureSafe
    ? `<div class="sb-pdf-signature"><img src="${signatureSafe}" alt="" /></div>`
    : '';

  let bodyRows = '';
  (lines || []).forEach((row, i) => {
    const discountCell = showDiscountColPdf
      ? `<td class="num">${formatAmtPdf(row.DIS_AMT ?? row.dis_amt)}</td>`
      : '';
    const taxCellsAfterDisc = !isBillOfSupplyNoTax
      ? `
              <td class="num">${formatAmtPdf(row.TAXABLE ?? row.taxable)}</td>
              <td class="num">${formatAmtPdf(row.CGST_AMT ?? row.cgst_amt)}</td>
              <td class="num">${formatAmtPdf(row.SGST_AMT ?? row.sgst_amt)}</td>
              <td class="num">${formatAmtPdf(row.IGST_AMT ?? row.igst_amt)}</td>`
      : '';
    bodyRows += `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(sbCell(row, 'ITEM_NAME', 'item_name'))}</td>
              ${printPackingPdf ? `<td>${escHtml(String(sbCell(row, 'PACKING', 'packing') || '').slice(0, 3))}</td>` : ''}
              <td>${escHtml(String(sbCell(row, 'HSN_CODE', 'hsn_code') || '').slice(0, 8))}</td>
              <td class="num">${formatQtyPdf(row.QNTY ?? row.qnty)}</td>
              ${printGWeightPdf ? `<td class="num">${formatQtyPdf(row.G_WEIGHT ?? row.g_weight)}</td>` : ''}
              ${printGWeightPdf ? `<td class="num">${formatQtyPdf(row.D_WEIGHT ?? row.d_weight)}</td>` : ''}
              <td class="num">${formatQtyPdf(row.WEIGHT ?? row.weight)}</td>
              <td class="num">${formatAmtPdf(row.RATE ?? row.rate)}</td>
              <td class="num">${formatAmtPdf(row.AMOUNT ?? row.amount)}</td>
              ${discountCell}${taxCellsAfterDisc}
            </tr>`;
  });

  const words = escHtml(rupeesToWords(t.billAmt || t.sumAmt || 0));
  const brokerLine =
    [rowFieldCI(f, 'bk_name'), rowFieldCI(f, 'bk_code')].filter(Boolean).join(' — ') || '—';
  const bankAcNo = rowFieldAny(h, ['bank_ac_no', 'BANK_AC_NO']);
  const bankAcNo1 = rowFieldAny(h, ['bank_ac_no1', 'BANK_AC_NO1']);
  const bankHtml =
    bankAcNo || bankAcNo1
      ? `<div class="sb-pdf-bank">${bankAcNo ? `<div>${escHtml(bankAcNo)}</div>` : ''}${
          bankAcNo1 ? `<div>${escHtml(bankAcNo1)}</div>` : ''
        }</div>`
      : '';
  const truckNo = rowFieldCI(f, 'truck_no');
  const tptVal = rowFieldCI(f, 'tpt');
  const grNoVal = rowFieldCI(f, 'gr_no');
  const transportHtml =
    truckNo || tptVal || grNoVal
      ? `<div class="sb-pdf-transport">${
          truckNo ? `<span><strong>Truck no.:</strong> ${escHtml(truckNo)}</span>` : ''
        }${tptVal ? `<span><strong>Tpt:</strong> ${escHtml(tptVal)}</span>` : ''}${
          grNoVal ? `<span><strong>GR no.:</strong> ${escHtml(grNoVal)}</span>` : ''
        }</div>`
      : '';
  const printDispatch = String(rowFieldCI(f, 'god_print_in_sale') || '').trim().toUpperCase() === 'Y';
  const godAdd1 = rowFieldCI(f, 'god_add1');
  const godAdd2 = rowFieldCI(f, 'god_add2');
  const godTel1 = rowFieldCI(f, 'god_tel_no_1');
  const godTel2 = rowFieldCI(f, 'god_tel_no_2');
  const godFssai = rowFieldCI(f, 'god_fssai_no');
  const godGst = rowFieldCI(f, 'god_gst_no');
  const dispatchColHtml =
    printDispatch && (godAdd1 || godAdd2 || godTel1 || godTel2 || godFssai || godGst)
      ? `<div>
          <div class="sb-pdf-h">Dispatch From</div>
          ${godAdd1 ? `<div>${escHtml(godAdd1)}</div>` : ''}
          ${godAdd2 ? `<div>${escHtml(godAdd2)}</div>` : ''}
          ${godTel1 || godTel2 ? `<div>Tel: ${escHtml([godTel1, godTel2].filter(Boolean).join(', '))}</div>` : ''}
          ${godFssai ? `<div>FSSAI No.: ${escHtml(godFssai)}</div>` : ''}
          ${godGst ? `<div>GST No.: ${escHtml(godGst)}</div>` : ''}
        </div>`
      : '';
  const terms = ['cond1', 'cond2', 'cond3', 'cond4', 'cond5', 'cond6', 'cond7']
    .map((k) => rowFieldCI(f, k))
    .filter((x) => x != null && String(x).trim() !== '');
  const termsHtml =
    terms.length > 0
      ? `<div class="sb-pdf-terms">
          <div class="sb-pdf-h">Terms &amp; Conditions:</div>
          ${terms.map((term) => `<div>${escHtml(term)}</div>`).join('')}
        </div>`
      : '';
  const iecNo = cleanPrintText(rowFieldAny(h, ['comp_tin', 'iec_no']));
  const fssaiNo = cleanPrintText(rowFieldAny(h, ['fssai_no']));
  const llpin = cleanPrintText(rowFieldAny(h, ['llpin']));
  const cinNo = cleanPrintText(rowFieldAny(h, ['cin_no']));
  const udyamRegNo = cleanPrintText(rowFieldAny(h, ['udyam_reg_no']));
  const emailVal = cleanPrintText(rowFieldCI(h, 'email'));
  const websiteVal = cleanPrintText(rowFieldAny(h, ['website', 'web_site', 'comp_website', 'site', 'url']));
  const compAdd1 = cleanPrintText(rowFieldAny(h, ['comp_add1', 'compadd1', 'address1']));
  const compAdd2 = cleanPrintText(rowFieldAny(h, ['comp_add2', 'compadd2', 'address2']));
  const compAdd3 = cleanPrintText(rowFieldAny(h, ['comp_add3', 'compadd3', 'address3']));
  const compTel1 = cleanPrintText(rowFieldAny(h, ['comp_tel1', 'comptel1', 'tel1', 'phone1']));
  const compTel2 = cleanPrintText(rowFieldAny(h, ['comp_tel2', 'comptel2', 'tel2', 'phone2']));
  const compGst = cleanPrintText(rowFieldAny(h, ['gst_no', 'gstno', 'comp_gst', 'gstin']));
  const compPan = cleanPrintText(rowFieldAny(h, ['comp_pan', 'pan', 'company_pan']));
  const headingLines = [];
  if (compAdd1) headingLines.push(compAdd1);
  if (compAdd2) headingLines.push(compAdd2);
  if (compAdd3) headingLines.push(compAdd3);
  const phoneLine = [compTel1, compTel2].filter(Boolean).join(' ');
  if (phoneLine) headingLines.push(`Tel: ${phoneLine}`);
  const gstPanLine = [compGst ? `GST: ${compGst}` : '', compPan ? `PAN: ${compPan}` : '']
    .filter(Boolean)
    .join('    |    ');
  if (gstPanLine) headingLines.push(gstPanLine);
  const iecFssaiLine = [iecNo ? `IEC No.: ${iecNo}` : '', fssaiNo ? `FSSAI No.: ${fssaiNo}` : '']
    .filter(Boolean)
    .join('    |    ');
  if (iecFssaiLine) headingLines.push(iecFssaiLine);
  if (llpin) headingLines.push(`LLPIN: ${llpin}`);
  const cinUdyamLine = [cinNo ? `CIN: ${cinNo}` : '', udyamRegNo ? `UDAYM: ${udyamRegNo}` : '']
    .filter(Boolean)
    .join('    |    ');
  if (cinUdyamLine) headingLines.push(cinUdyamLine);
  const tailHeadingLines = [];
  if (emailVal) tailHeadingLines.push(`Email: ${emailVal}`);
  if (websiteVal) tailHeadingLines.push(`Website: ${websiteVal}`);
  const maxHeadingLines = 6;
  const keepFromMain = Math.max(0, maxHeadingLines - tailHeadingLines.length);
  const mainHeadingLines = [...headingLines.slice(0, keepFromMain), ...tailHeadingLines].slice(0, maxHeadingLines);
  const totalsLeftQrHtml = qrHtml
    ? `<div class="sb-pdf-total-side sb-pdf-total-side-left">${qrHtml}</div>`
    : '<div class="sb-pdf-total-side sb-pdf-total-side-left sb-pdf-total-side--empty"></div>';
  const topRightLogo2Html = logo2Safe
    ? `<div class="sb-pdf-top-right"><div class="sb-pdf-logo2"><img src="${logo2Safe}" alt="" /></div></div>`
    : '<div class="sb-pdf-top-right sb-pdf-top-right--empty"></div>';
  const irnNoPdf = String(rowFieldCI(f, 'irn_no') || '').trim();
  const ackNoPdf = String(rowFieldCI(f, 'ack_no') || '').trim();
  const ewayNoPdf = String(rowFieldCI(f, 'eway_no') || '').trim();
  const irnRowsPdf = [
    irnNoPdf ? `<div>Irn No.: ${escHtml(irnNoPdf)}</div>` : '',
    ackNoPdf ? `<div>Ack.No.: ${escHtml(ackNoPdf)}</div>` : '',
    ewayNoPdf ? `<div>Eway No.: ${escHtml(ewayNoPdf)}</div>` : '',
  ].filter(Boolean).join('');
  const irnBlockPdf = irnRowsPdf ? `<div class="sb-pdf-irn">${irnRowsPdf}</div>` : '';

  return `
    <div class="report-doc sb-pdf${isBillOfSupplyNoTax ? ' sb-pdf-bos' : ''}">
      <style>${PDF_REPORT_STYLES}${SALE_BILL_PDF_STYLES}</style>
      <div class="sb-pdf-top">
        ${logoHtml}
        <div class="sb-pdf-top-main">
          <div class="sb-pdf-title">${escHtml(docTitle || '')}</div>
          <div class="sb-pdf-co" style="font-size:${companyNameFontPx}px">${company}</div>
          ${mainHeadingLines.map((line) => `<div class="sb-pdf-addr">${escHtml(line)}</div>`).join('')}
        </div>
        ${topRightLogo2Html}
      </div>

      ${
        isCreditNotePdf
          ? `<div class="sb-pdf-inv">
        <span class="sb-pdf-inv-item"><strong>Credit Note no.</strong> ${cnBillNoEsc}</span>
        <span class="sb-pdf-inv-item"><strong>Dated</strong> ${billDt}</span>
      </div>
      <div class="sb-pdf-inv sb-pdf-inv-cn-sub sb-pdf-inv-cn-sub--3">
        <span class="sb-pdf-inv-item"><strong>Invoice no.</strong> ${sbNoEsc}</span>
        <span class="sb-pdf-inv-item"><strong>Type</strong> ${sbTypeEsc}</span>
        <span class="sb-pdf-inv-item"><strong>Invoice date</strong> ${sbDateEsc}</span>
      </div>`
          : `<div class="sb-pdf-inv">
        <span class="sb-pdf-inv-item"><strong>Invoice no.</strong> ${saleInv}</span>
        <span class="sb-pdf-inv-item"><strong>Dated</strong> ${billDt}</span>
      </div>`
      }
      <hr class="sb-pdf-inv-rule" />
      ${irnBlockPdf}

      <div class="sb-pdf-two ${dispatchColHtml ? 'sb-pdf-three' : ''}">
        <div>
          <div class="sb-pdf-h">Buyer (billed to)</div>
          <div class="sb-pdf-party-name">${fv('name')}</div>
          <div>${fv('add1')}</div>
          <div>${fv('add2')}</div>
          <div>${fv('city')}</div>
          <div>GST: ${fv('gst_no') || '—'}</div>
          <div>PAN: ${fv('pan') || '—'}</div>
        </div>
        <div>
          <div class="sb-pdf-h">Shipped to</div>
          <div class="sb-pdf-party-name">${fv('delv_name') || '—'}</div>
          <div>${fv('delv_add1') || '—'}</div>
          <div>${fv('delv_add2') || '—'}</div>
          <div>${fv('delv_city') || '—'}</div>
          <div>GST: ${fv('delv_gst_no') || '—'}</div>
          <div>PAN: ${fv('delv_pan') || '—'}</div>
        </div>
        ${dispatchColHtml}
      </div>

      <div class="sb-pdf-broker"><strong>Broker:</strong> ${escHtml(brokerLine)}</div>

      <table class="sb-pdf-grid${isBillOfSupplyNoTax ? ' sb-pdf-grid-bos' : ''}">
        <thead>
          <tr>
            <th>Sno</th>
            <th>Particulars</th>
            ${printPackingPdf ? '<th style="width:54px; white-space:nowrap;">Packing</th>' : ''}
            <th style="width:76px; white-space:nowrap;">Hsn Code</th>
            <th class="num">Qty</th>
            ${printGWeightPdf ? `<th class="num">G.Wt<br><small>${gWeightHeaderPdf}</small></th>` : ''}
            ${printGWeightPdf ? `<th class="num">Dane<br><small>${dWeightHeaderPdf}</small></th>` : ''}
            <th class="num">Wt<br><small>${gWeightHeaderPdf}</small></th>
            <th class="num">Rate<br><small>${rateHeaderPdf}</small></th>
            <th class="num">Amount<br><small>In Rs.</small></th>
            ${showDiscountColPdf ? `<th class="num">Disc</th>` : ''}
            ${
              !isBillOfSupplyNoTax
                ? `<th class="num">Taxable</th><th class="num">${escHtml(cgstLabel)}</th><th class="num">${escHtml(sgstLabel)}</th><th class="num">${escHtml(igstLabel)}</th>`
                : ''
            }
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <div class="sb-pdf-sum-row">
        ${totalsLeftQrHtml}
        <div class="sb-pdf-sum-main">
          <table class="sb-pdf-sum">
            <tbody>
              <tr><td>Total amount</td><td class="num">${formatAmtPdf(t.sumAmt)}</td></tr>
              ${Math.abs(Number(t.disAmt || 0)) > 0.0001 ? `<tr><td>Discount</td><td class="num">${formatAmtPdf(t.disAmt)}</td></tr>` : ''}
              ${
                !isBillOfSupplyNoTax
                  ? `${Math.abs(Number(t.sumTax || 0)) > 0.0001 ? `<tr><td>Total taxable</td><td class="num">${formatAmtPdf(t.sumTax)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumC || 0)) > 0.0001 ? `<tr><td>${escHtml(cgstLabel)}</td><td class="num">${formatAmtPdf(t.sumC)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumS || 0)) > 0.0001 ? `<tr><td>${escHtml(sgstLabel)}</td><td class="num">${formatAmtPdf(t.sumS)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumI || 0)) > 0.0001 ? `<tr><td>${escHtml(igstLabel)}</td><td class="num">${formatAmtPdf(t.sumI)}</td></tr>` : ''}`
                  : ''
              }
              ${Math.abs(Number(t.freight || 0)) > 0.0001 ? `<tr><td>Freight</td><td class="num">${formatAmtPdf(t.freight)}</td></tr>` : ''}
              ${(Array.isArray(t.expenseItems) ? t.expenseItems : [])
                .map(
                  (item) =>
                    `<tr><td>${escHtml(item.label || 'Other expense')}</td><td class="num">${formatAmtPdf(item.amount)}</td></tr>`
                )
                .join('')}
              ${Math.abs(Number(t.othExp5 || 0)) > 0.0001 ? `<tr><td>Round off</td><td class="num">${formatAmtPdf(t.othExp5)}</td></tr>` : ''}
            </tbody>
          </table>
          <div class="sb-pdf-net-words-row">
            <div class="sb-pdf-words-inline"><strong>Rs in words:</strong> ${words}</div>
            <div class="sb-pdf-net-amount">
              <div><strong>Net amount</strong></div>
              <div class="num"><strong>${formatAmtPdf(t.billAmt)}</strong></div>
            </div>
          </div>
        </div>
      </div>
      ${bankHtml}
      ${transportHtml}
      <hr class="sb-pdf-footer-rule" />
      <div class="sb-pdf-bottom">
        <div class="sb-pdf-bottom-left">${termsHtml}</div>
        <div class="sb-pdf-bottom-right">
          <div class="sb-pdf-sign">
            <div>For ${company}</div>
            ${signatureHtml}
            <div class="sb-pdf-auth">Authorised signatory</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function stockNum(row, u, l) {
  const v = row?.[u] ?? row?.[l];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function formatStockPdf(n, frac = 2) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

/** Item-wise stock summary (LOTSTOCK) */
function buildStockSumReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const endDt = escHtml(metadata.endDate || '');
  const god = escHtml(metadata.godLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tRq = 0;
  let tSq = 0;
  let tRw = 0;
  let tSw = 0;
  let tBags = 0;
  let tKatta = 0;
  let tHkatta = 0;
  let tWt = 0;
  let tGw = 0;

  let body = '';
  rows.forEach((r) => {
    tRq += stockNum(r, 'R_QNTY', 'r_qnty');
    tSq += stockNum(r, 'S_QNTY', 's_qnty');
    tRw += stockNum(r, 'R_WEIGHT', 'r_weight');
    tSw += stockNum(r, 'S_WEIGHT', 's_weight');
    tBags += stockNum(r, 'BAGS', 'bags');
    tKatta += stockNum(r, 'KATTA', 'katta');
    tHkatta += stockNum(r, 'HKATTA', 'hkatta');
    tWt += stockNum(r, 'WEIGHT', 'weight');
    tGw += stockNum(r, 'G_WEIGHT', 'g_weight');
    body += `<tr>
      <td>${escHtml(r.ITEM_CODE ?? r.item_code ?? '')}</td>
      <td class="col-name">${escHtml(r.ITEM_NAME ?? r.item_name ?? '')}</td>
      <td>${escHtml(r.SCHEDULE ?? r.schedule ?? '')}</td>
      <td>${escHtml(r.CAT_CODE ?? r.cat_code ?? '')}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'R_QNTY', 'r_qnty'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'S_QNTY', 's_qnty'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'R_WEIGHT', 'r_weight'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'S_WEIGHT', 's_weight'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'BAGS', 'bags'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'KATTA', 'katta'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'HKATTA', 'hkatta'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'WEIGHT', 'weight'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'G_WEIGHT', 'g_weight'))}</td>
    </tr>`;
  });

  const grandRow = `<tr class="report-grand-total">
    <td colspan="4" class="lbl-total">Grand total (${rows.length} items)</td>
    <td class="amount">${formatStockPdf(tRq, 3)}</td>
    <td class="amount">${formatStockPdf(tSq, 3)}</td>
    <td class="amount">${formatStockPdf(tRw)}</td>
    <td class="amount">${formatStockPdf(tSw)}</td>
    <td class="amount">${formatStockPdf(tBags, 3)}</td>
    <td class="amount">${formatStockPdf(tKatta, 3)}</td>
    <td class="amount">${formatStockPdf(tHkatta, 3)}</td>
    <td class="amount">${formatStockPdf(tWt)}</td>
    <td class="amount">${formatStockPdf(tGw)}</td>
  </tr>`;

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock sum (by item)</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          As on <strong>${endDt}</strong> · Godown: <strong>${god}</strong><br />
          Generated: ${generated}
        </div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Item</th>
            <th>Name</th>
            <th>Sch</th>
            <th>Cat</th>
            <th class="amount">R qty</th>
            <th class="amount">S qty</th>
            <th class="amount">R wt</th>
            <th class="amount">S wt</th>
            <th class="amount">Bags</th>
            <th class="amount">Katta</th>
            <th class="amount">H katta</th>
            <th class="amount">Net wt</th>
            <th class="amount">G wt</th>
          </tr>
        </thead>
        <tbody>${body}${grandRow}</tbody>
      </table>
      <div class="report-foot">R = receipt, S = issue / sale side. Net wt and G wt are signed totals from LOTSTOCK.</div>
    </div>
  `;
}

/** Lot-wise lines for one item with running balance */
function buildStockSumDetailReportHtml(data, metadata) {
  const raw = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const endDt = escHtml(metadata.endDate || '');
  const god = escHtml(metadata.godLabel ?? '');
  const itemCode = escHtml(metadata.itemCode || '');
  const itemName = escHtml(metadata.itemName || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let runQ = 0;
  let runW = 0;
  let runG = 0;
  let body = '';
  raw.forEach((r) => {
    const rq = stockNum(r, 'R_QNTY', 'r_qnty');
    const sq = stockNum(r, 'S_QNTY', 's_qnty');
    const rw = stockNum(r, 'R_WEIGHT', 'r_weight');
    const sw = stockNum(r, 'S_WEIGHT', 's_weight');
    const rg = stockNum(r, 'R_G_WEIGHT', 'r_g_weight');
    const sg = stockNum(r, 'SG_WEIGHT', 'sg_weight');
    runQ += rq - sq;
    runW += rw - sw;
    runG += rg - sg;
    const vdt = escHtml(formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date));
    body += `<tr>
      <td>${vdt}</td>
      <td>${escHtml(String(r.VR_NO ?? r.vr_no ?? ''))}</td>
      <td>${escHtml(String(r.VR_TYPE ?? r.vr_type ?? ''))}</td>
      <td>${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
      <td>${escHtml(String(r.LOT ?? r.lot ?? ''))}</td>
      <td>${escHtml(String(r.STATUS ?? r.status ?? ''))}</td>
      <td>${escHtml(String(r.B_NO ?? r.b_no ?? ''))}</td>
      <td>${escHtml(String(r.GOD_CODE ?? r.god_code ?? ''))}</td>
      <td class="amount">${formatStockPdf(rq, 3)}</td>
      <td class="amount">${formatStockPdf(sq, 3)}</td>
      <td class="amount">${formatStockPdf(rw)}</td>
      <td class="amount">${formatStockPdf(sw)}</td>
      <td class="amount">${formatStockPdf(rg)}</td>
      <td class="amount">${formatStockPdf(sg)}</td>
      <td class="amount bal">${formatStockPdf(runQ, 3)}</td>
      <td class="amount bal">${formatStockPdf(runW)}</td>
      <td class="amount bal">${formatStockPdf(runG)}</td>
    </tr>`;
  });

  const grandRow = `<tr class="report-grand-total">
    <td colspan="8" class="lbl-total">Closing balance (running total)</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">${formatStockPdf(runQ, 3)}</td>
    <td class="amount">${formatStockPdf(runW)}</td>
    <td class="amount">${formatStockPdf(runG)}</td>
  </tr>`;

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock detail — ${itemCode}</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          ${itemName}<br />
          As on <strong>${endDt}</strong> · Godown: <strong>${god}</strong><br />
          Generated: ${generated}
        </div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Vr dt</th>
            <th>Vr no</th>
            <th>Vr typ</th>
            <th>Type</th>
            <th>Lot</th>
            <th>St</th>
            <th>B no</th>
            <th>God</th>
            <th class="amount">R qty</th>
            <th class="amount">S qty</th>
            <th class="amount">R wt</th>
            <th class="amount">S wt</th>
            <th class="amount">R g wt</th>
            <th class="amount">S g wt</th>
            <th class="amount">Run qty</th>
            <th class="amount">Run wt</th>
            <th class="amount">Run g wt</th>
          </tr>
        </thead>
        <tbody>${body}${raw.length ? grandRow : ''}</tbody>
      </table>
      <div class="report-foot">Running balance = cumulative (R − S) per row for qty, weight, and gross weight.</div>
    </div>
  `;
}

/** Stock lot summary with optional filters */
function buildStockLotReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const endDt = escHtml(metadata.endDate || '');
  const god = escHtml(metadata.godLabel || 'All godowns');
  const item = escHtml(metadata.itemLabel || 'All items');
  const sup = escHtml(metadata.supplierLabel || 'All suppliers');
  const cost = escHtml(metadata.costLabel || 'All cost codes');
  const bNo = escHtml(metadata.bNo || 'All');
  const lot = escHtml(metadata.lot || 'All');
  const co = escHtml(metadata.coLabel || 'Outstanding');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tq = 0;
  let tb = 0;
  let tk = 0;
  let th = 0;
  let tw = 0;
  let tgw = 0;
  let body = '';
  rows.forEach((r) => {
    const q = stockNum(r, 'QNTY', 'qnty');
    const b = stockNum(r, 'BAGS', 'bags');
    const k = stockNum(r, 'KATTA', 'katta');
    const h = stockNum(r, 'HKATTA', 'hkatta');
    const w = stockNum(r, 'WEIGHT', 'weight');
    const gw = stockNum(r, 'G_WEIGHT', 'g_weight');
    tq += q;
    tb += b;
    tk += k;
    th += h;
    tw += w;
    tgw += gw;
    body += `<tr>
      <td>${escHtml(String(r.ITEM_CODE ?? r.item_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.ITEM_NAME ?? r.item_name ?? ''))}</td>
      <td>${escHtml(String(r.LOT ?? r.lot ?? ''))}</td>
      <td>${escHtml(String(r.B_NO ?? r.b_no ?? ''))}</td>
      <td>${escHtml(String(r.SUP_CODE ?? r.sup_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.SUP_NAME ?? r.sup_name ?? ''))}</td>
      <td>${escHtml(String(r.SCHEDULE ?? r.schedule ?? ''))}</td>
      <td>${escHtml(String(r.GOD_CODE ?? r.god_code ?? ''))}</td>
      <td>${escHtml(String(r.GOD_NAME ?? r.god_name ?? ''))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date))}</td>
      <td>${escHtml(String(r.COST_CODE ?? r.cost_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.REMARKS ?? r.remarks ?? ''))}</td>
      <td class="amount">${formatStockPdf(q, 3)}</td>
      <td class="amount">${formatStockPdf(b, 3)}</td>
      <td class="amount">${formatStockPdf(k, 3)}</td>
      <td class="amount">${formatStockPdf(h, 3)}</td>
      <td class="amount">${formatStockPdf(w)}</td>
      <td class="amount">${formatStockPdf(gw)}</td>
    </tr>`;
  });

  const grand = rows.length
    ? `<tr class="report-grand-total">
      <td colspan="12" class="lbl-total">Grand total</td>
      <td class="amount">${formatStockPdf(tq, 3)}</td>
      <td class="amount">${formatStockPdf(tb, 3)}</td>
      <td class="amount">${formatStockPdf(tk, 3)}</td>
      <td class="amount">${formatStockPdf(th, 3)}</td>
      <td class="amount">${formatStockPdf(tw)}</td>
      <td class="amount">${formatStockPdf(tgw)}</td>
    </tr>`
    : '';

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock lot</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">As on</td><td class="val">${endDt}</td><td class="lbl">C/O</td><td class="val">${co}</td></tr>
          <tr><td class="lbl">Godown</td><td class="val">${god}</td><td class="lbl">Item</td><td class="val">${item}</td></tr>
          <tr><td class="lbl">Supplier</td><td class="val">${sup}</td><td class="lbl">Cost</td><td class="val">${cost}</td></tr>
          <tr><td class="lbl">Bikri no</td><td class="val">${bNo}</td><td class="lbl">Lot</td><td class="val">${lot}</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Item</th>
            <th>Item name</th>
            <th>Lot</th>
            <th>Bikri</th>
            <th>Sup</th>
            <th>Supplier name</th>
            <th>Sch</th>
            <th>God</th>
            <th>God name</th>
            <th>Vr dt</th>
            <th>Cost</th>
            <th>Remarks</th>
            <th class="amount">Qty</th>
            <th class="amount">Bags</th>
            <th class="amount">Katta</th>
            <th class="amount">H katta</th>
            <th class="amount">Weight</th>
            <th class="amount">G weight</th>
          </tr>
        </thead>
        <tbody>${body}${grand}</tbody>
      </table>
      <div class="report-foot">Outstanding mode excludes rows whose net quantity is zero.</div>
    </div>
  `;
}

function purchaseDnSigned(row, upper, lower) {
  const v = stockNum(row, upper, lower);
  const t = String(row?.TYPE ?? row?.type ?? '').trim().toUpperCase();
  return t === 'DN' ? -Math.abs(v) : v;
}

/** Purchase bill / debit note PDF (portrait) */
function buildPurchaseBillReportHtml(data, metadata) {
  const { lines, header, first, docTitle, totals } = data;
  const h = header || {};
  const f = first || {};
  const t = totals || {};
  const company = escHtml(metadata.companyName || '');

  const hv = (logical) => {
    const raw = rowFieldCI(h, logical);
    return raw ? escHtml(raw) : '';
  };
  const fv = (logical) => {
    const raw = rowFieldCI(f, logical);
    return raw ? escHtml(raw) : '';
  };

  const billAmtNum = Number(t.billAmt) || 0;
  const tdsAmtNum = Number(t.ntdsAmt) || 0;
  const isPbPdf =
    String(f.TYPE ?? f.type ?? '')
      .trim()
      .toUpperCase() === 'PB' ||
    String(metadata?.purchaseBillKey || '')
      .toUpperCase()
      .startsWith('PB_');
  const isEvPdf =
    String(f.TYPE ?? f.type ?? '')
      .trim()
      .toUpperCase() === 'EV' ||
    String(docTitle || '')
      .toUpperCase()
      .includes('EXPENSES') ||
    String(metadata?.purchaseBillKey || '')
      .toUpperCase()
      .startsWith('EV_');
  const purchaseKeyTypePdf = String(metadata?.purchaseBillKey || '')
    .trim()
    .split('_')[0]
    .toUpperCase();
  const lineTypePdf = String(f.TYPE ?? f.type ?? '').trim().toUpperCase();
  const effectiveTypePdf = purchaseKeyTypePdf || lineTypePdf;
  const isDebitPdf = ['DN', 'DX'].includes(effectiveTypePdf) || String(docTitle || '').toUpperCase().includes('DEBIT');
  const isCreditPdf = ['CN', 'CX'].includes(effectiveTypePdf) || String(docTitle || '').toUpperCase().includes('CREDIT');

  const noLabelPdf = isDebitPdf ? 'Debit Note No.' : isCreditPdf ? 'Credit Note No.' : 'R no.';
  const dateLabelPdf = isDebitPdf ? 'Debit Note Date' : isCreditPdf ? 'Credit Note Date' : 'R date';
  const netPayableNum =
    t.netPayable != null && t.netPayable !== '' ? Number(t.netPayable) || 0 : billAmtNum - tdsAmtNum;
  const wordsBase = Math.abs(tdsAmtNum) > 0.0001 ? netPayableNum : billAmtNum || Number(t.sumAmt) || 0;
  const wordsRaw = wordsBase < 0 ? 'Minus ' + rupeesToWords(Math.abs(wordsBase)) : rupeesToWords(wordsBase);
  const words = escHtml(wordsRaw);

  let bodyRows = '';
  (lines || []).forEach((row, i) => {
    const midCol = isEvPdf
      ? `<td class="num">${formatAmtPdf(purchaseDnSigned(row, 'FREIGHT', 'freight'))}</td>`
      : `<td class="num">${formatAmtPdf(purchaseDnSigned(row, 'DIS_AMT', 'dis_amt'))}</td>`;
    const qtyCol = isEvPdf
      ? ''
      : `<td class="num">${formatQtyPdf(purchaseDnSigned(row, 'QNTY', 'qnty'))}</td>`;
    bodyRows += `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(sbCell(row, 'ITEM_CODE', 'item_code'))}</td>
              <td>${escHtml(sbCell(row, 'ITEM_NAME', 'item_name'))}</td>
              <td>${escHtml(sbCell(row, 'HSN_CODE', 'hsn_code'))}</td>
              ${qtyCol}
              <td class="num">${formatQtyPdf(purchaseDnSigned(row, 'WEIGHT', 'weight'))}</td>
              <td class="num">${formatAmtPdf(stockNum(row, 'RATE', 'rate'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'AMOUNT', 'amount'))}</td>
              ${midCol}
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'TAXABLE', 'taxable'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'CGST_AMT', 'cgst_amt'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'SGST_AMT', 'sgst_amt'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'IGST_AMT', 'igst_amt'))}</td>
            </tr>`;
  });

  const brokerLine =
    [rowFieldCI(f, 'bk_name'), rowFieldCI(f, 'b_code')].filter(Boolean).join(' — ') || '—';
  const bankAcNo = rowFieldAny(h, ['bank_ac_no', 'BANK_AC_NO']);
  const bankAcNo1 = rowFieldAny(h, ['bank_ac_no1', 'BANK_AC_NO1']);
  const bankHtml =
    bankAcNo || bankAcNo1
      ? `<div class="sb-pdf-bank">${bankAcNo ? `<div>${escHtml(bankAcNo)}</div>` : ''}${
          bankAcNo1 ? `<div>${escHtml(bankAcNo1)}</div>` : ''
        }</div>`
      : '';
  const truckNo = rowFieldCI(f, 'truck');
  const tptVal = rowFieldCI(f, 'tpt');
  const grNoVal = rowFieldCI(f, 'gr_no');
  const transportHtml =
    truckNo || tptVal || grNoVal
      ? `<div class="sb-pdf-transport">${
          truckNo ? `<span><strong>Truck:</strong> ${escHtml(truckNo)}</span>` : ''
        }${tptVal ? `<span><strong>Tpt:</strong> ${escHtml(tptVal)}</span>` : ''}${
          grNoVal ? `<span><strong>GR no.:</strong> ${escHtml(grNoVal)}</span>` : ''
        }</div>`
      : '';

  const othLbl = (nameKey, fallback) => {
    const nm = String(t[nameKey] || '').trim();
    return nm || fallback;
  };
  const sumPairs = [
    ['Total amount', t.sumAmt],
    isEvPdf ? ['Freight', t.sumFreight] : ['Discount', t.sumDis],
    ['Taxable', t.sumTax],
    ['CGST', t.sumC],
    ['SGST', t.sumS],
    ['IGST', t.sumI],
    [othLbl('othName1', 'Oth exp 1'), t.oth1],
    [othLbl('othName2', 'Oth exp 2'), t.oth2],
    [othLbl('othName3', 'Oth exp 3'), t.oth3],
    [othLbl('othName4', 'Oth exp 4'), t.oth4],
    [othLbl('othName5', 'Oth exp 5'), t.oth5],
    [othLbl('othName6', 'Oth exp 6'), t.oth6],
    [othLbl('othName7', 'Oth exp 7'), t.oth7],
    [othLbl('othName8', 'Oth exp 8'), t.oth8],
    ['Commission', t.commAmt],
    ['Mudat', t.mudAmt],
    ['Brokerage', t.brokAmt],
    ...(isPbPdf || isEvPdf
      ? []
      : [
          ['Broker paid', t.brokPaid],
          ['Freight paid', t.freightPaid],
          ['Mandi exp', t.mandiExp],
          ['Labour exp', t.labourExp],
          ['Bardana exp', t.bardanaExp],
          ['CD amount', t.cdAmount],
          ['Dharm kanta', t.dharmKanta],
          ['Tulwai exp', t.tulwaiExp],
          ['Round off', t.roundOff],
          ['TCS', t.tcsAmt],
        ]),
    ...(isEvPdf && Math.abs(Number(t.tcsAmt) || 0) > 0.0001 ? [['TCS', t.tcsAmt]] : []),
    ['Bill amt', t.billAmt],
    ...(Math.abs(tdsAmtNum) > 0.0001
      ? [
          ['Less TDS', tdsAmtNum],
          ['Net Payable', netPayableNum],
        ]
      : []),
  ].filter(
    ([lbl, val]) =>
      lbl === 'Bill amt' ||
      lbl === 'Net Payable' ||
      lbl === 'Total amount' ||
      lbl === 'Discount' ||
      lbl === 'Freight' ||
      Math.abs(Number(val) || 0) > 0.0001
  );
  let sumBody = '';
  sumPairs.forEach(([lbl, val]) => {
    sumBody += `<tr><td>${escHtml(lbl)}</td><td class="num">${formatAmtPdf(val)}</td></tr>`;
  });

  const qtyHead = isEvPdf ? '' : '<th class="num">Qty</th>';
  const midHead = isEvPdf ? '<th class="num">Freight</th>' : '<th class="num">Disc</th>';

  return `
    <div class="report-doc sb-pdf">
      <style>${PDF_REPORT_STYLES}${SALE_BILL_PDF_STYLES}</style>
      <div class="sb-pdf-top">
        <div class="sb-pdf-top-main">
          <div class="sb-pdf-title">${escHtml(docTitle || '')}</div>
          <div class="sb-pdf-co">${company}</div>
          ${hv('comp_add1') ? `<div class="sb-pdf-addr">${hv('comp_add1')}</div>` : ''}
          ${hv('comp_add2') ? `<div class="sb-pdf-addr">${hv('comp_add2')}</div>` : ''}
          ${hv('comp_add3') ? `<div class="sb-pdf-addr">${hv('comp_add3')}</div>` : ''}
          <div class="sb-pdf-addr">
            ${hv('comp_tel1') ? `Tel: ${hv('comp_tel1')}` : ''}
            ${hv('comp_tel2') ? ` ${hv('comp_tel2')}` : ''}
          </div>
          <div class="sb-pdf-addr">GstNo: ${escHtml(rowFieldAny(h, ['gst_no', 'gstno', 'comp_gst', 'gstin']) || '—')} · pan: ${escHtml(rowFieldAny(h, ['comp_pan', 'pan', 'company_pan']) || '—')}</div>
          ${hv('email') ? `<div class="sb-pdf-addr">EMAIL: ${hv('email')}</div>` : ''}
        </div>
      </div>

      <div class="sb-pdf-inv">
        <span><strong>${escHtml(noLabelPdf)}</strong> ${escHtml(String(f.R_NO ?? f.r_no ?? '—'))}</span>
        <span><strong>${escHtml(dateLabelPdf)}</strong> ${escHtml(formatLedgerDateDisplay(f.R_DATE ?? f.r_date))}</span>
        <span><strong>Bill no.</strong> ${escHtml(String(f.BILL_NO ?? f.bill_no ?? '—'))}</span>
        <span><strong>Bill date</strong> ${escHtml(formatLedgerDateDisplay(f.BILL_DATE ?? f.bill_date))}</span>
      </div>

      <div class="sb-pdf-two">
        <div>
          <div class="sb-pdf-h">Party name</div>
          <div>${fv('name')}</div>
          <div>${fv('add1')}</div>
          <div>${fv('add2')}</div>
          <div>${fv('add3')}</div>
          <div>${fv('city')}</div>
          <div>GST: ${fv('gst_no') || '—'}</div>
          <div>PAN: ${fv('pan') || '—'}</div>
        </div>
        <div></div>
      </div>

      <div class="sb-pdf-broker"><strong>Broker:</strong> ${escHtml(brokerLine)}</div>

      <table class="sb-pdf-grid">
        <thead>
          <tr>
            <th>Sno</th>
            <th>Item</th>
            <th>Item name</th>
            <th>HSN</th>
            ${qtyHead}
            <th class="num">Wt</th>
            <th class="num">Rate</th>
            <th class="num">Amt</th>
            ${midHead}
            <th class="num">Taxable</th>
            <th class="num">CGST</th>
            <th class="num">SGST</th>
            <th class="num">IGST</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <table class="sb-pdf-sum" style="width:100%;max-width:320px">
        <tbody>${sumBody}</tbody>
      </table>
      <div class="sb-pdf-net-words-row" style="width:100%;max-width:320px">
        <div class="sb-pdf-words-inline"><strong>Rs in words:</strong> ${words}</div>
      </div>
      <hr class="sb-pdf-footer-rule" />
      ${bankHtml}
      ${transportHtml}
      <div class="sb-pdf-sign">
        <div>For ${company}</div>
        <div class="sb-pdf-auth">Authorised signatory</div>
      </div>
    </div>
  `;
}

/** Purchase list (PU / DN) */
function buildExpensesVoucherListReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tw = 0;
  let ta = 0;
  let tf = 0;
  let tc = 0;
  let ts = 0;
  let ti = 0;
  let toth = 0;
  let ttcs = 0;
  let tntds = 0;
  let tb = 0;
  let body = '';
  rows.forEach((r) => {
    const w = stockNum(r, 'WEIGHT', 'weight');
    const a = stockNum(r, 'AMOUNT', 'amount');
    const f = stockNum(r, 'FREIGHT', 'freight');
    const c = stockNum(r, 'CGST_AMT', 'cgst_amt');
    const s = stockNum(r, 'SGST_AMT', 'sgst_amt');
    const i = stockNum(r, 'IGST_AMT', 'igst_amt');
    const oth = stockNum(r, 'OTH_EXP_1', 'oth_exp_1');
    const tcs = stockNum(r, 'TCS_AMT', 'tcs_amt');
    const ntds = stockNum(r, 'NTDS_AMT', 'ntds_amt');
    const b = stockNum(r, 'BILL_AMT', 'bill_amt');
    tw += w;
    ta += a;
    tf += f;
    tc += c;
    ts += s;
    ti += i;
    toth += oth;
    ttcs += tcs;
    tntds += ntds;
    tb += b;
    const itemHsn = [String(r.ITEM_NAME ?? r.item_name ?? '').trim(), String(r.HSN_CODE ?? r.hsn_code ?? '').trim()]
      .filter(Boolean)
      .join(' / ');
    const gstNo = String(r.GST_NO ?? r.gst_no ?? '').trim();
    body += `<tr>
      <td>${escHtml(formatLedgerDateDisplay(r.R_DATE ?? r.r_date))}</td>
      <td>${escHtml(String(r.R_NO ?? r.r_no ?? ''))}</td>
      <td>${escHtml(String(r.BILL_NO ?? r.bill_no ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.NAME ?? r.name ?? ''))}</td>
      <td class="amount">${formatStockPdf(w)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'RATE', 'rate'), 4)}</td>
      <td class="amount">${formatStockPdf(a)}</td>
      <td class="amount">${formatStockPdf(f)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'CGST_PER', 'cgst_per'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'SGST_PER', 'sgst_per'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'IGST_PER', 'igst_per'))}</td>
      <td class="amount">${formatStockPdf(c)}</td>
      <td class="amount">${formatStockPdf(s)}</td>
      <td class="amount">${formatStockPdf(i)}</td>
      <td class="amount">${formatStockPdf(oth)}</td>
      <td class="amount">${formatStockPdf(tcs)}<br/>${formatStockPdf(ntds)}</td>
      <td class="amount">${formatStockPdf(b)}</td>
    </tr>
    <tr>
      <td colspan="3">${escHtml(itemHsn || '—')}</td>
      <td colspan="14">${escHtml(gstNo || '—')}</td>
    </tr>`;
  });

  const grand = `<tr class="report-grand-total">
      <td colspan="4" class="lbl-total">Grand total</td>
      <td class="amount">${formatStockPdf(tw)}</td>
      <td class="amount">—</td>
      <td class="amount">${formatStockPdf(ta)}</td>
      <td class="amount">${formatStockPdf(tf)}</td>
      <td class="amount">—</td>
      <td class="amount">—</td>
      <td class="amount">—</td>
      <td class="amount">${formatStockPdf(tc)}</td>
      <td class="amount">${formatStockPdf(ts)}</td>
      <td class="amount">${formatStockPdf(ti)}</td>
      <td class="amount">${formatStockPdf(toth)}</td>
      <td class="amount">${formatStockPdf(ttcs)}<br/>${formatStockPdf(tntds)}</td>
      <td class="amount">${formatStockPdf(tb)}</td>
    </tr>`;

  return `
    <div class="report-doc purchase-list-pdf exp-voucher-list-pdf">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">EXPENSES</div>
        <h1>EXPENSES VOUCHER LIST FROM ${sdt} TO ${edt}</h1>
        <div class="company">${company}</div>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Date</th><th>No.</th><th>Bill No</th><th>Name/GST No.</th>
            <th class="amount">Weight</th><th class="amount">Rate</th><th class="amount">Amount</th>
            <th class="amount">Freight</th>
            <th class="amount">Cg%</th><th class="amount">Sg%</th><th class="amount">Ig%</th>
            <th class="amount">Cgst</th><th class="amount">Sgst</th><th class="amount">Igst</th>
            <th class="amount">Others</th><th class="amount">Tcs/Tds</th><th class="amount">Net Amt.</th>
          </tr>
          <tr>
            <th colspan="3">Item Name/Hsn Code</th>
            <th colspan="14"></th>
          </tr>
        </thead>
        <tbody>${body}${grand}</tbody>
      </table>
    </div>
  `;
}

function buildPurchaseListReportHtml(data, metadata) {
  if (String(metadata?.listKind || '').toUpperCase() === 'EV') {
    return buildExpensesVoucherListReportHtml(data, metadata);
  }
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const sup = escHtml(metadata.supplierLabel || 'All');
  const item = escHtml(metadata.itemLabel || 'All');
  const pur = escHtml(metadata.purLabel || 'All');
  const god = escHtml(metadata.godLabel || 'All');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tq = 0;
  let tw = 0;
  let ta = 0;
  let tt = 0;
  let tc = 0;
  let ts = 0;
  let ti = 0;
  let tb = 0;
  let body = '';
  rows.forEach((r) => {
    const q = purchaseDnSigned(r, 'QNTY', 'qnty');
    const w = purchaseDnSigned(r, 'WEIGHT', 'weight');
    const a = purchaseDnSigned(r, 'AMOUNT', 'amount');
    const tx = purchaseDnSigned(r, 'TAXABLE', 'taxable');
    const c = purchaseDnSigned(r, 'CGST_AMT', 'cgst_amt');
    const s = purchaseDnSigned(r, 'SGST_AMT', 'sgst_amt');
    const i = purchaseDnSigned(r, 'IGST_AMT', 'igst_amt');
    const b = purchaseDnSigned(r, 'BILL_AMT', 'bill_amt');
    tq += q;
    tw += w;
    ta += a;
    tt += tx;
    tc += c;
    ts += s;
    ti += i;
    tb += b;
    body += `<tr>
      <td>${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.R_DATE ?? r.r_date))}</td>
      <td>${escHtml(String(r.R_NO ?? r.r_no ?? ''))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date))}</td>
      <td>${escHtml(String(r.BILL_NO ?? r.bill_no ?? ''))}</td>
      <td>${escHtml(String(r.CODE ?? r.code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.NAME ?? r.name ?? ''))}</td>
      <td>${escHtml(String(r.TRN_NO ?? r.trn_no ?? ''))}</td>
      <td>${escHtml(String(r.PUR_CODE ?? r.pur_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.PUR_NAME ?? r.pur_name ?? ''))}</td>
      <td>${escHtml(String(r.ITEM_CODE ?? r.item_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.ITEM_NAME ?? r.item_name ?? ''))}</td>
      <td>${escHtml(String(r.GOD_CODE ?? r.god_code ?? ''))}</td>
      <td>${escHtml(String(r.LOT ?? r.lot ?? ''))}</td>
      <td>${escHtml(String(r.B_NO ?? r.b_no ?? ''))}</td>
      <td class="amount">${formatStockPdf(q, 3)}</td>
      <td class="amount">${formatStockPdf(w)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'RATE', 'rate'))}</td>
      <td class="amount">${formatStockPdf(a)}</td>
      <td class="amount">${formatStockPdf(tx)}</td>
      <td class="amount">${formatStockPdf(c)}</td>
      <td class="amount">${formatStockPdf(s)}</td>
      <td class="amount">${formatStockPdf(i)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'FREIGHT', 'freight'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'LABOUR', 'labour'))}</td>
      <td class="amount">${formatStockPdf(b)}</td>
    </tr>`;
  });

  const grand = `<tr class="report-grand-total">
      <td colspan="15" class="lbl-total">Grand total</td>
      <td class="amount">${formatStockPdf(tq, 3)}</td>
      <td class="amount">${formatStockPdf(tw)}</td>
      <td class="amount">—</td>
      <td class="amount">${formatStockPdf(ta)}</td>
      <td class="amount">${formatStockPdf(tt)}</td>
      <td class="amount">${formatStockPdf(tc)}</td>
      <td class="amount">${formatStockPdf(ts)}</td>
      <td class="amount">${formatStockPdf(ti)}</td>
      <td class="amount">—</td>
      <td class="amount">—</td>
      <td class="amount">${formatStockPdf(tb)}</td>
    </tr>`;

  return `
    <div class="report-doc purchase-list-pdf">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">PURCHASE</div>
        <h1>Purchase list (PU / DN)</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Dates</td><td class="val">${sdt} to ${edt}</td><td class="lbl">Supplier</td><td class="val">${sup}</td></tr>
          <tr><td class="lbl">Item</td><td class="val">${item}</td><td class="lbl">Purchase code</td><td class="val">${pur}</td></tr>
          <tr><td class="lbl">Godown</td><td class="val" colspan="3">${god}</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Type</th><th>R date</th><th>R no</th><th>Bill dt</th><th>Bill no</th><th>Code</th><th>Name</th><th>Trn</th>
            <th>Pur code</th><th>Pur name</th><th>Item</th><th>Item name</th><th>God</th><th>Lot</th><th>B no</th>
            <th class="amount">Qty</th><th class="amount">Wt</th><th class="amount">Rate</th><th class="amount">Amt</th>
            <th class="amount">Taxable</th><th class="amount">CGST</th><th class="amount">SGST</th><th class="amount">IGST</th>
            <th class="amount">Freight</th><th class="amount">Labour</th><th class="amount">Bill amt</th>
          </tr>
        </thead>
        <tbody>${body}${grand}</tbody>
      </table>
      <div class="report-foot">For TYPE DN, qty/weight/amount/tax and bill amount are shown as negative.</div>
    </div>
  `;
}

function buildGstr1ReportHtml(payload, metadata) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const sheets = data.sheets && typeof data.sheets === 'object' ? data.sheets : {};
  const activeSheet = String(metadata?.activeSheet || Object.keys(sheets)[0] || '').trim();
  const rows = Array.isArray(sheets[activeSheet]) ? sheets[activeSheet] : [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const company = escHtml(metadata?.companyName || '');
  const fy = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.period || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const thead = columns.map((c) => `<th>${escHtml(c)}</th>`).join('');
  const tbody = rows
    .map((r) => {
      const tds = columns
        .map((c) => {
          const v = r[c];
          const isNum = typeof v === 'number';
          return `<td class="${isNum ? 'amount' : ''}">${escHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">GST</div>
        <h1>GSTR-1</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
          <tr><td class="lbl">Sheet</td><td class="val" colspan="3">${escHtml(activeSheet)} (${rows.length} rows)</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td>(No rows)</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function buildHsnSalesReportHtml(payload, metadata) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const normalizeColKey = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const columns = (rows.length > 0 ? Object.keys(rows[0]) : []).filter((c) => normalizeColKey(c) !== 'HSNUNIT');
  const company = escHtml(metadata?.companyName || '');
  const fy = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.period || '');
  const title = escHtml(metadata?.reportTitle || 'HSN Sales');
  const view = escHtml(metadata?.activeView || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const thead = columns
    .map((c) => `<th${normalizeColKey(c).includes('BILLDATE') ? ' style="white-space: nowrap !important;"' : ''}>${escHtml(c)}</th>`)
    .join('');
  const tbody = rows
    .map((r) => {
      const tds = columns
        .map((c) => {
          const v = r[c];
          const isNum = typeof v === 'number';
          const billDateNoWrap = normalizeColKey(c).includes('BILLDATE') ? ' style="white-space: nowrap !important;"' : '';
          return `<td class="${isNum ? 'amount' : ''}"${billDateNoWrap}>${escHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">HSN SALES</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
          <tr><td class="lbl">View</td><td class="val" colspan="3">${view || '—'} (${rows.length} rows)</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td>(No rows)</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function buildStateWiseSalesReportHtml(payload, metadata) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
      : ['State Code', 'State', 'Gst%', 'Qty.', 'Weight', 'Taxable', 'Cgst Amt.', 'Sgst Amt.', 'Igst Amt.'];
  const company = escHtml(metadata?.companyName || '');
  const fy = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.period || '');
  const stateFilter = escHtml(metadata?.stateFilter || 'All states');
  const title = escHtml(metadata?.reportTitle || 'State Wise Sales');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const thead = columns.map((c) => `<th>${escHtml(c)}</th>`).join('');
  const tbody = rows
    .map((r) => {
      const tds = columns
        .map((c) => {
          const v = r[c];
          const isNum = typeof v === 'number';
          return `<td class="${isNum ? 'amount' : ''}">${escHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">${escHtml(String(metadata?.reportTitle || 'State Wise Sales').toUpperCase())}</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
          <tr><td class="lbl">State</td><td class="val" colspan="3">${stateFilter} (${rows.length} rows)</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td>(No rows)</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function buildBalanceSheetReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Balance Sheet');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const totals = metadata.totals || {};
  const fmt = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isMainSch = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 11 && Math.abs(n - Math.trunc(n)) < 0.0001;
  };
  const body = rows
    .map((r) => {
      const lSch = rowFieldAny(r, ['L_SCH_NO']) || '';
      const lDetail = rowFieldAny(r, ['L_DETAIL']) || '';
      const lAmt = Number(rowFieldAny(r, ['CR_AMT'])) || Number(rowFieldAny(r, ['L_AMOUNT'])) || 0;
      const lMain = isMainSch(lSch);
      const aSch = rowFieldAny(r, ['A_SCH_NO']) || '';
      const aDetail = rowFieldAny(r, ['A_DETAIL']) || '';
      const aAmt = Number(rowFieldAny(r, ['DR_AMT'])) || Number(rowFieldAny(r, ['A_AMOUNT'])) || 0;
      const aMain = isMainSch(aSch);
      return `<tr>
        <td class="${lMain ? 'bs-main' : ''}">${escHtml(String(lSch || '').trim())}</td>
        <td class="${lMain ? 'bs-main' : ''}">${escHtml(String(lDetail || '').trim())}</td>
        <td class="num ${lMain ? 'bs-main' : ''}">${lAmt ? escHtml(fmt(lAmt)) : ''}</td>
        <td class="${aMain ? 'bs-main' : ''}">${escHtml(String(aSch || '').trim())}</td>
        <td class="${aMain ? 'bs-main' : ''}">${escHtml(String(aDetail || '').trim())}</td>
        <td class="num ${aMain ? 'bs-main' : ''}">${aAmt ? escHtml(fmt(aAmt)) : ''}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .bs-pdf .report-topbar { padding-bottom: 8px; }
        .bs-pdf h1 { font-size: 18px; margin-bottom: 4px; }
        .bs-pdf .company { font-size: 14px; }
        .bs-pdf .report-grid { font-size: 11px; }
        .bs-pdf .table-report { width: 100%; table-layout: fixed; font-size: 9px; }
        .bs-pdf .table-report th,
        .bs-pdf .table-report td { padding: 3px 5px; line-height: 1.15; }
        .bs-pdf .table-report th:nth-child(1),
        .bs-pdf .table-report td:nth-child(1),
        .bs-pdf .table-report th:nth-child(4),
        .bs-pdf .table-report td:nth-child(4) { width: 7%; }
        .bs-pdf .table-report th:nth-child(2),
        .bs-pdf .table-report td:nth-child(2),
        .bs-pdf .table-report th:nth-child(5),
        .bs-pdf .table-report td:nth-child(5) { width: 28%; white-space: nowrap; }
        .bs-pdf .table-report th:nth-child(3),
        .bs-pdf .table-report td:nth-child(3),
        .bs-pdf .table-report th:nth-child(6),
        .bs-pdf .table-report td:nth-child(6) { width: 15%; }
        .bs-pdf .table-report td.num,
        .bs-pdf .table-report th.num { text-align: right; white-space: nowrap; }
        .bs-pdf .bs-main { color: #b91c1c; font-weight: 700; }
      </style>
      <div class="report-topbar bs-pdf">
        <div class="kicker">BALANCE SHEET</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
        </table>
      </div>
      <table class="table-report bs-pdf">
        <thead>
          <tr>
            <th>L Sch</th>
            <th>Liabilities</th>
            <th class="num">Amount</th>
            <th>A Sch</th>
            <th>Assets</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="6">(No rows)</td></tr>'}</tbody>
        <tfoot>
          <tr>
            <td></td>
            <td class="bs-main">TOTAL</td>
            <td class="num bs-main">${escHtml(fmt(totals.liabilitiesTotal || 0))}</td>
            <td></td>
            <td class="bs-main">TOTAL</td>
            <td class="num bs-main">${escHtml(fmt(totals.assetsTotal || 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function buildTradingAccountReportHtml(data, metadata) {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const stockRows = Array.isArray(payload.stockRows) ? payload.stockRows : [];
  const expenseRows = Array.isArray(payload.expenseRows) ? payload.expenseRows : [];
  const summary = payload.summary || {};
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Trading A/C');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const fmt = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const body = [];
  stockRows.forEach((r) => {
    const titleText = escHtml(String(r.NAME || r.CODE || '').trim());
    const lTotal = (Number(r.OAMT) || 0) + (Number(r.PAMT) || 0) + (Number(r.GPROFIT) || 0);
    const rTotal = (Number(r.SAMT) || 0) + (Number(r.CAMT) || 0) + (Number(r.GLOSS) || 0);
    body.push(`<tr class="trading-title"><td colspan="8">${titleText}</td></tr>`);
    body.push(`<tr><td>OPENING</td><td class="num">${qty(r.OWGT)}</td><td class="num">${fmt(r.OAMT)}</td><td class="num"></td><td>SALES</td><td class="num">${qty(r.SWGT)}</td><td class="num">${fmt(r.SAMT)}</td><td class="num"></td></tr>`);
    body.push(`<tr><td>PURCHASE</td><td class="num">${qty(r.PWGT)}</td><td class="num">${fmt(r.PAMT)}</td><td class="num"></td><td>SHORT/ACCESS</td><td class="num">${qty(r.SHORT)}</td><td class="num"></td><td class="num"></td></tr>`);
    body.push(`<tr><td>G.PROFIT</td><td class="num"></td><td class="num">${fmt(r.GPROFIT)}</td><td class="num"></td><td>CLOSING</td><td class="num">${qty(r.CWGT)}</td><td class="num">${fmt(r.CAMT)}</td><td class="num"></td></tr>`);
    body.push(`<tr><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td>G.LOSS</td><td class="num"></td><td class="num">${fmt(r.GLOSS)}</td><td class="num"></td></tr>`);
    body.push(`<tr class="trading-total"><td>TOTAL</td><td class="num"></td><td class="num">${fmt(lTotal)}</td><td class="num"></td><td>TOTAL</td><td class="num"></td><td class="num">${fmt(rTotal)}</td><td class="num"></td></tr>`);
  });
  expenseRows.forEach((r) => {
    body.push(`<tr><td>${escHtml(String(r.NAME || '').trim())}</td><td class="num"></td><td class="num">${Number(r.DR_AMT) ? fmt(r.DR_AMT) : ''}</td><td class="num"></td><td></td><td class="num"></td><td class="num">${Number(r.CR_AMT) ? fmt(r.CR_AMT) : ''}</td><td class="num"></td></tr>`);
  });
  const summaryRows = `
    <tr class="trading-summary-head"><td colspan="8">SUMMARY</td></tr>
    <tr><td>OPENING</td><td class="num"></td><td class="num">${fmt(summary.opening)}</td><td class="num"></td><td>SALES</td><td class="num"></td><td class="num">${fmt(summary.sales)}</td><td class="num">${fmt(summary.salesRate)}</td></tr>
    <tr><td>PURCHASE</td><td class="num"></td><td class="num">${fmt(summary.purchase)}</td><td class="num">${fmt(summary.purchaseRate)}</td><td>CL.STOCK</td><td class="num"></td><td class="num">${fmt(summary.closing)}</td><td class="num"></td></tr>
    <tr><td>DIRECT EXP.</td><td class="num"></td><td class="num">${fmt(summary.directExp)}</td><td class="num"></td><td>DIRECT INCOME</td><td class="num"></td><td class="num">${fmt(summary.directInc)}</td><td class="num"></td></tr>
    <tr class="trading-total"><td>G.TOTAL</td><td class="num"></td><td class="num">${fmt(summary.leftTotal)}</td><td class="num"></td><td>G.TOTAL</td><td class="num"></td><td class="num">${fmt(summary.rightTotal)}</td><td class="num"></td></tr>
    <tr class="trading-total"><td>TOTAL GROSS PROFIT/LOSS</td><td class="num"></td><td class="num">${fmt(summary.grossProfitLoss)}</td><td class="num"></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td></tr>
  `;
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .trading-ac-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; }
        .trading-ac-pdf .table-report th, .trading-ac-pdf .table-report td { padding: 3px 4px; line-height: 1.12; }
        .trading-ac-pdf .table-report td.num, .trading-ac-pdf .table-report th.num { text-align: right; white-space: nowrap; }
        .trading-ac-pdf .trading-title td { font-weight: 700; border-top: 1px solid #999; }
        .trading-ac-pdf .trading-total td { font-weight: 700; border-top: 1px solid #ccc; }
        .trading-ac-pdf .trading-summary-head td { font-weight: 700; text-align: center; border-top: 2px solid #999; }
      </style>
      <div class="report-topbar trading-ac-pdf">
        <div class="kicker">TRADING A/C</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid"><tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr></table>
      </div>
      <table class="table-report trading-ac-pdf">
        <thead>
          <tr>
            <th>Particulars</th><th class="num">Weight</th><th class="num">Amount</th><th class="num">Avg.Rate</th>
            <th>Particulars</th><th class="num">Weight</th><th class="num">Amount</th><th class="num">Avg.Rate</th>
          </tr>
        </thead>
        <tbody>${body.join('')}${summaryRows}</tbody>
      </table>
    </div>
  `;
}

function buildProfitLossReportHtml(data, metadata) {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const trading = payload.trading || {};
  const blocks = Array.isArray(payload.scheduleBlocks) ? payload.scheduleBlocks : [];
  const totals = payload.totals || {};
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Profit & Loss Account');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const fmt = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pairDebitCreditRows = (lines) => {
    const debit = [];
    const credit = [];
    (lines || []).forEach((ln) => {
      const drAmt = Number(ln?.DR_AMT) || 0;
      const crAmt = Number(ln?.CR_AMT) || 0;
      const drDetail = String(ln?.DR_DETAIL || '').trim();
      const crDetail = String(ln?.CR_DETAIL || '').trim();
      if (drAmt !== 0 || drDetail) debit.push({ detail: drDetail, amount: drAmt });
      if (crAmt !== 0 || crDetail) credit.push({ detail: crDetail, amount: crAmt });
    });
    const rowCount = Math.max(debit.length, credit.length);
    const out = [];
    for (let i = 0; i < rowCount; i += 1) {
      out.push({
        drDetail: debit[i]?.detail || '',
        drAmt: debit[i]?.amount || 0,
        crDetail: credit[i]?.detail || '',
        crAmt: credit[i]?.amount || 0,
      });
    }
    return out;
  };

  const amountCell = (v) => ((Number(v) || 0) ? escHtml(fmt(v)) : '');
  const lineRow = (lPart, lAmt, rPart, rAmt, cls = '') => `<tr class="${cls}">
    <td>${escHtml(String(lPart || '').trim()) || '&nbsp;'}</td>
    <td class="num">${amountCell(lAmt)}</td>
    <td>${escHtml(String(rPart || '').trim()) || '&nbsp;'}</td>
    <td class="num">${amountCell(rAmt)}</td>
  </tr>`;

  const sectionRows = [];
  sectionRows.push(`<tr class="pl-section"><td colspan="4">TRADING (SCHEDULE 12.10)</td></tr>`);
  sectionRows.push(lineRow(trading.DR_DETAIL, trading.DR_AMT, trading.CR_DETAIL, trading.CR_AMT));
  sectionRows.push(lineRow('SCHEDULE TOTAL', trading.DR_AMT, '', trading.CR_AMT, 'pl-total'));
  if (blocks.length) sectionRows.push(`<tr class="pl-section"><td colspan="4">SCHEDULE 16 ONWARDS</td></tr>`);
  blocks.forEach((blk) => {
    sectionRows.push(`<tr class="pl-schedule"><td colspan="4">${escHtml(String(blk.schedule || ''))} ${escHtml(String(blk.schName || ''))}</td></tr>`);
    const paired = pairDebitCreditRows(Array.isArray(blk.lines) ? blk.lines : []);
    paired.forEach((ln) => {
      sectionRows.push(lineRow(ln.drDetail, ln.drAmt, ln.crDetail, ln.crAmt));
    });
    sectionRows.push(lineRow('SCHEDULE TOTAL', blk.scheduleTotalDr, '', blk.scheduleTotalCr, 'pl-total'));
  });
  sectionRows.push(lineRow('TOTAL EXPENSES WITH GL', totals.totalLeftDr, 'TOTAL INCOME WITHOUT GP', totals.totalIncomeWithoutGp, 'pl-total'));
  sectionRows.push(lineRow(totals.netProfit ? 'NET PROFIT' : '', totals.netProfit, totals.netLoss ? 'NET LOSS' : '', totals.netLoss, 'pl-total'));
  sectionRows.push(lineRow('TOTAL', totals.grandTotal, 'TOTAL', totals.grandTotal, 'pl-grand'));

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .pl-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .pl-pdf .pl-header { text-align: center; margin-bottom: 10px; }
        .pl-pdf .pl-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .pl-pdf .pl-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .pl-pdf .pl-period { font-size: 11px; margin-top: 4px; color: #444; }
        .pl-pdf .table-report { width: 100%; table-layout: fixed; font-size: 11px; border-collapse: collapse; }
        .pl-pdf .table-report th, .pl-pdf .table-report td { padding: 2px 3px; line-height: 1.08; vertical-align: top; }
        .pl-pdf .table-report thead th { text-align: left; border-top: 1px solid #999; border-bottom: 1px solid #999; background: #fff; color: #111; }
        .pl-pdf .table-report thead th.num, .pl-pdf .table-report td.num { text-align: right; white-space: nowrap; }
        .pl-pdf .table-report th:nth-child(1), .pl-pdf .table-report td:nth-child(1) { width: 39%; }
        .pl-pdf .table-report th:nth-child(2), .pl-pdf .table-report td:nth-child(2) { width: 11%; border-right: 1px solid #c8c8c8; }
        .pl-pdf .table-report th:nth-child(3), .pl-pdf .table-report td:nth-child(3) { width: 39%; }
        .pl-pdf .table-report th:nth-child(4), .pl-pdf .table-report td:nth-child(4) { width: 11%; }
        .pl-pdf .table-report td:nth-child(1),
        .pl-pdf .table-report td:nth-child(3) { white-space: normal; overflow-wrap: anywhere; }
        .pl-pdf .pl-section td { padding-top: 7px; padding-bottom: 3px; font-weight: 700; text-transform: uppercase; }
        .pl-pdf .pl-schedule td { padding-top: 5px; padding-bottom: 2px; font-weight: 700; }
        .pl-pdf .pl-total td { font-weight: 700; border-top: 1px solid #d8d8d8; }
        .pl-pdf .pl-grand td { font-weight: 700; border-top: 1px solid #777; }
      </style>
      <div class="pl-pdf report-doc">
        <div class="pl-header">
          <div class="pl-company">${company}</div>
          <div class="pl-title">${title}</div>
          <div class="pl-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Particulars</th>
              <th class="num">Amount</th>
              <th>Particulars</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>${sectionRows.join('') || '<tr><td colspan="4">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildItemMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Item Master List');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.ITEM_CODE ?? r?.item_code ?? '')}</td>
        <td>${escHtml(r?.ITEM_NAME ?? r?.item_name ?? '')}</td>
        <td>${escHtml(r?.CAT ?? r?.cat ?? '')}</td>
        <td>${escHtml(r?.CAT_CODE ?? r?.cat_code ?? '')}</td>
        <td>${escHtml(r?.HSN_CODE ?? r?.hsn_code ?? '')}</td>
        <td>${escHtml(r?.TAX_PER ?? r?.tax_per ?? '')}</td>
        <td>${escHtml(r?.S_CODE ?? r?.s_code ?? '')}</td>
        <td>${escHtml(r?.P_CODE ?? r?.p_code ?? '')}</td>
        <td>${escHtml(r?.AMT_CAL ?? r?.amt_cal ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .imm-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .imm-pdf .imm-header { text-align: center; margin-bottom: 10px; }
        .imm-pdf .imm-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .imm-pdf .imm-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .imm-pdf .imm-period { font-size: 11px; margin-top: 4px; color: #444; }
        .imm-pdf .table-report { width: 100%; table-layout: fixed; font-size: 9px; border-collapse: collapse; }
        .imm-pdf .table-report th, .imm-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; word-break: break-word; }
        .imm-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
      </style>
      <div class="imm-pdf report-doc">
        <div class="imm-header">
          <div class="imm-company">${company}</div>
          <div class="imm-title">${title}</div>
          <div class="imm-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Item code</th>
              <th>Item name</th>
              <th>Cat</th>
              <th>Cat code</th>
              <th>HSN</th>
              <th>GST %</th>
              <th>S code</th>
              <th>P code</th>
              <th>AmtCal</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="9">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildScheduleMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Schedule Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');
  const view = metadata.scheduleView || 'all';
  const isAll = view === 'all' || view === 'complete';
  const isSub = !isAll && view === 'sub';

  const body = isAll
    ? rows
        .map(
          (r) => `<tr class="${String(r?.TYPE ?? r?.type ?? '').toLowerCase() === 'main' ? 'schm-main' : 'schm-sub'}">
        <td>${escHtml(r?.SCHEDULE_NO ?? r?.schedule_no ?? r?.SUB_GROUP ?? '')}</td>
        <td>${escHtml(r?.TYPE ?? r?.type ?? '')}</td>
        <td>${escHtml(r?.NAME ?? r?.name ?? '')}</td>
        <td>${escHtml(r?.RANGE ?? r?.range ?? '')}</td>
        <td>${escHtml(r?.NORM_BAL ?? r?.norm_bal ?? '')}</td>
        <td>${escHtml(r?.CORR_NO ?? r?.corr_no ?? '')}</td>
      </tr>`
        )
        .join('')
    : isSub
      ? rows
          .map(
            (r) => `<tr>
        <td>${escHtml(r?.SUB_GROUP ?? r?.sub_group ?? '')}</td>
        <td>${escHtml(r?.NAME ?? r?.name ?? '')}</td>
        <td>${escHtml(r?.RANGE ?? r?.range ?? '')}</td>
        <td>${escHtml(r?.NORM_BAL ?? r?.norm_bal ?? '')}</td>
        <td>${escHtml(r?.CORR_NO ?? r?.corr_no ?? '')}</td>
      </tr>`
          )
          .join('')
      : rows
          .map(
            (r) => `<tr>
        <td>${escHtml(r?.SCHEDULE_NO ?? r?.schedule_no ?? '')}</td>
        <td>${escHtml(r?.NAME ?? r?.name ?? '')}</td>
      </tr>`
          )
          .join('');

  const head = isAll
    ? '<tr><th>Schedule</th><th>Type</th><th>Name</th><th>Range</th><th>Nor.Bal</th><th>Corr.N</th></tr>'
    : isSub
      ? '<tr><th>Sub group</th><th>Name</th><th>Range</th><th>Nor.Bal</th><th>Corr.N</th></tr>'
      : '<tr><th>Schedule</th><th>Name</th></tr>';
  const colSpan = isAll ? 6 : isSub ? 5 : 2;

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .schm-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .schm-pdf .schm-header { text-align: center; margin-bottom: 10px; }
        .schm-pdf .schm-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .schm-pdf .schm-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .schm-pdf .schm-period { font-size: 11px; margin-top: 4px; color: #444; }
        .schm-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .schm-pdf .table-report th, .schm-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; }
        .schm-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
        .schm-pdf .table-report tr.schm-main td { background: #e8eef5; font-weight: 700; }
        .schm-pdf .table-report tr.schm-sub td:first-child { padding-left: 10px; }
      </style>
      <div class="schm-pdf report-doc">
        <div class="schm-header">
          <div class="schm-company">${company}</div>
          <div class="schm-title">${title}</div>
          <div class="schm-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>${head}</thead>
          <tbody>${body || `<tr><td colspan="${colSpan}">(No rows)</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildItemGrpReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Item Group Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.GRP_CODE ?? r?.grp_code ?? r?.GROUP ?? '')}</td>
        <td>${escHtml(r?.GRP_NAME ?? r?.grp_name ?? r?.NAME ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .igrp-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .igrp-pdf .igrp-header { text-align: center; margin-bottom: 10px; }
        .igrp-pdf .igrp-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .igrp-pdf .igrp-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .igrp-pdf .igrp-period { font-size: 11px; margin-top: 4px; color: #444; }
        .igrp-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .igrp-pdf .table-report th, .igrp-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; }
        .igrp-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
      </style>
      <div class="igrp-pdf report-doc">
        <div class="igrp-header">
          <div class="igrp-company">${company}</div>
          <div class="igrp-title">${title}</div>
          <div class="igrp-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Group</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="2">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function opdetPartyTotals(partyLines) {
  let bill = 0;
  let pmt = 0;
  for (const r of partyLines || []) {
    const trn = Number(r?.TRN_NO ?? r?.trn_no ?? 0) || 0;
    const billAmt = Number(r?.BILL_AMT ?? r?.bill_amt ?? 0) || 0;
    const pmtAmt = Number(r?.PMT_AMT ?? r?.pmt_amt ?? 0) || 0;
    if (trn === 1) bill += billAmt;
    pmt += pmtAmt;
  }
  return { bill, pmt, balance: bill - pmt };
}

function buildOpdetReportHtml(data, metadata = {}) {
  const lines = Array.isArray(data?.lines) ? data.lines : Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'OP.BILLS DETAIL');
  const fy = escHtml(metadata.year || '—');
  const fyStart = escHtml(formatLedgerDateDisplay(metadata.fyStart) || '—');
  const fyEnd = escHtml(formatLedgerDateDisplay(metadata.fyEnd) || '—');
  const period = escHtml(metadata.period || `Financial Year ${fyStart} TO ${fyEnd}`);

  const groups = [];
  const groupMap = new Map();
  for (const r of lines) {
    const code = String(r?.CODE ?? r?.code ?? '').trim();
    if (!groupMap.has(code)) {
      const g = { code, name: String(r?.AC_NAME ?? r?.ac_name ?? '').trim(), lines: [] };
      groupMap.set(code, g);
      groups.push(g);
    }
    groupMap.get(code).lines.push(r);
  }

  let grandBill = 0;
  let grandPmt = 0;
  const sections = groups
    .map((g) => {
      const totals = opdetPartyTotals(g.lines);
      grandBill += totals.bill;
      grandPmt += totals.pmt;
      const detailRows = g.lines
        .map((r) => {
          const bCode = String(r?.B_CODE ?? r?.b_code ?? '').trim();
          const bName = String(r?.BROKER_NAME ?? r?.broker_name ?? '').trim();
          const broker = bCode ? `${escHtml(bCode)}<br/>${escHtml(bName)}` : escHtml(bName);
          return `<tr>
            <td>${escHtml(formatLedgerDateDisplay(r?.BILL_DATE ?? r?.bill_date))}</td>
            <td class="num">${escHtml(r?.BILL_NO ?? r?.bill_no ?? '')}</td>
            <td>${escHtml(formatLedgerDateDisplay(r?.V_DATE ?? r?.v_date))}</td>
            <td class="num">${escHtml(r?.DAYS ?? r?.days ?? '')}</td>
            <td class="num">${formatAmtPdf(r?.BILL_AMT ?? r?.bill_amt)}</td>
            <td>${escHtml(formatLedgerDateDisplay(r?.PMT_DATE ?? r?.pmt_date))}</td>
            <td class="num">${formatAmtPdf(r?.PMT_AMT ?? r?.pmt_amt)}</td>
            <td>${broker}</td>
            <td class="num">${escHtml(r?.OP_NO ?? r?.op_no ?? '')}</td>
          </tr>`;
        })
        .join('');
      return `
        <tr class="opdet-party-head"><td colspan="9"><strong>${escHtml(g.code)}</strong> &nbsp; ${escHtml(g.name)}</td></tr>
        ${detailRows}
        <tr class="opdet-party-total">
          <td colspan="4" class="num"><strong>TOTAL</strong></td>
          <td class="num"><strong>${formatAmtPdf(totals.bill)}</strong></td>
          <td></td>
          <td class="num"><strong>${formatAmtPdf(totals.pmt)}</strong></td>
          <td class="num"><strong>${formatAmtPdf(totals.balance)}</strong></td>
          <td></td>
        </tr>`;
    })
    .join('');

  const grandBalance = grandBill - grandPmt;

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .opdet-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .opdet-pdf .opdet-header { text-align: center; margin-bottom: 10px; }
        .opdet-pdf .opdet-company { font-size: 16px; font-weight: 700; text-transform: uppercase; }
        .opdet-pdf .opdet-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .opdet-pdf .opdet-period { font-size: 11px; margin-top: 4px; color: #444; }
        .opdet-pdf .table-report { width: 100%; table-layout: fixed; font-size: 9px; border-collapse: collapse; }
        .opdet-pdf .table-report th, .opdet-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; vertical-align: top; }
        .opdet-pdf .table-report thead th { background: #f4f4f4; text-align: center; }
        .opdet-pdf .table-report td.num, .opdet-pdf .table-report th.num { text-align: right; }
        .opdet-pdf .opdet-party-head td { background: #eef2ff; font-weight: 600; padding: 5px 6px; }
        .opdet-pdf .opdet-party-total td { background: #f8fafc; font-weight: 600; }
        .opdet-pdf .opdet-grand-total td { background: #e5e7eb; font-weight: 700; border-top: 2px solid #9ca3af; }
      </style>
      <div class="opdet-pdf report-doc">
        <div class="opdet-header">
          <div class="opdet-company">${company}</div>
          <div class="opdet-title">${title}</div>
          <div class="opdet-period">Financial Year ${fyStart} TO ${fyEnd} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>B.Date</th>
              <th class="num">B.No.</th>
              <th>V.Date</th>
              <th class="num">Dys</th>
              <th class="num">Bill.Amt.</th>
              <th>Pmt.Date</th>
              <th class="num">Pmt.Amt.</th>
              <th>Broker</th>
              <th class="num">Sr.No.</th>
            </tr>
          </thead>
          <tbody>
            ${sections || '<tr><td colspan="9">No records</td></tr>'}
            <tr class="opdet-grand-total">
              <td colspan="4" class="num">G.TOTAL</td>
              <td class="num">${formatAmtPdf(grandBill)}</td>
              <td></td>
              <td class="num">${formatAmtPdf(grandPmt)}</td>
              <td class="num">${formatAmtPdf(grandBalance)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function buildDetailMastMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Detail Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td class="num">${escHtml(r?.S_NO ?? r?.s_no ?? '')}</td>
        <td>${escHtml(r?.CODE ?? r?.code ?? '')}</td>
        <td>${escHtml(r?.AC_NAME ?? r?.ac_name ?? '')}</td>
        <td>${escHtml(r?.DETAIL ?? r?.detail ?? r?.DETAIL_PREVIEW ?? '')}</td>
        <td class="num">${escHtml(r?.LINES ?? r?.LINE_CNT ?? r?.line_cnt ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .detailmast-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .detailmast-pdf .detailmast-header { text-align: center; margin-bottom: 10px; }
        .detailmast-pdf .detailmast-company { font-size: 16px; font-weight: 700; text-transform: uppercase; }
        .detailmast-pdf .detailmast-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .detailmast-pdf .detailmast-period { font-size: 11px; margin-top: 4px; color: #444; }
        .detailmast-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .detailmast-pdf .table-report th, .detailmast-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; vertical-align: top; }
        .detailmast-pdf .table-report thead th { background: #f4f4f4; text-align: left; }
        .detailmast-pdf .table-report td.num, .detailmast-pdf .table-report th.num { text-align: right; }
      </style>
      <div class="detailmast-pdf report-doc">
        <div class="detailmast-header">
          <div class="detailmast-company">${company}</div>
          <div class="detailmast-title">${title}</div>
          <div class="detailmast-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th class="num">S_No</th>
              <th>A/c</th>
              <th>Name</th>
              <th>Detail</th>
              <th class="num">Lines</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="5">No records</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildLoanerListReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Loaner List');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');
  const schedule = escHtml(metadata.scheduleLabel || 'All schedules');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const body = rows
    .map(
      (r) => `<tr>
        <td class="col-code">${escHtml(r?.CODE ?? '')}</td>
        <td class="col-name">${escHtml(r?.NAME ?? '')}</td>
        <td class="col-pan">${escHtml(r?.PAN ?? '')}</td>
        <td class="amount">${formatAmtPdf(r?.OP)}</td>
        <td class="amount">${formatAmtPdf(r?.CR_AMT)}</td>
        <td class="amount">${formatAmtPdf(r?.CR_INT)}</td>
        <td class="amount">${formatAmtPdf(r?.TOT_CR)}</td>
        <td class="amount">${formatAmtPdf(r?.DR_AMT)}</td>
        <td class="amount">${formatAmtPdf(r?.DR_TDS)}</td>
        <td class="amount">${formatAmtPdf(r?.TOT_DR)}</td>
        <td class="amount">${formatAmtPdf(r?.CL_BAL)}</td>
        <td class="col-city">${escHtml(r?.CITY ?? '')}</td>
      </tr>`
    )
    .join('');

  const totals = rows.reduce(
    (acc, r) => {
      acc.OP += Number(r?.OP ?? 0);
      acc.CR_AMT += Number(r?.CR_AMT ?? 0);
      acc.CR_INT += Number(r?.CR_INT ?? 0);
      acc.TOT_CR += Number(r?.TOT_CR ?? 0);
      acc.DR_AMT += Number(r?.DR_AMT ?? 0);
      acc.DR_TDS += Number(r?.DR_TDS ?? 0);
      acc.TOT_DR += Number(r?.TOT_DR ?? 0);
      acc.CL_BAL += Number(r?.CL_BAL ?? 0);
      return acc;
    },
    { OP: 0, CR_AMT: 0, CR_INT: 0, TOT_CR: 0, DR_AMT: 0, DR_TDS: 0, TOT_DR: 0, CL_BAL: 0 }
  );

  const totalRow = rows.length
    ? `<tr class="report-grand-total">
        <td colspan="3" class="lbl-total">TOTAL</td>
        <td class="amount">${formatAmtPdf(totals.OP)}</td>
        <td class="amount">${formatAmtPdf(totals.CR_AMT)}</td>
        <td class="amount">${formatAmtPdf(totals.CR_INT)}</td>
        <td class="amount">${formatAmtPdf(totals.TOT_CR)}</td>
        <td class="amount">${formatAmtPdf(totals.DR_AMT)}</td>
        <td class="amount">${formatAmtPdf(totals.DR_TDS)}</td>
        <td class="amount">${formatAmtPdf(totals.TOT_DR)}</td>
        <td class="amount">${formatAmtPdf(totals.CL_BAL)}</td>
        <td></td>
      </tr>`
    : '';

  return `
    <div class="report-doc loaner-pdf-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .loaner-pdf-doc { padding: 4px 6px 10px; }
        .loaner-pdf-doc .report-topbar { margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid; }
        .loaner-pdf-doc table.table-report { table-layout: fixed; width: 100%; font-size: 7.5px; }
        .loaner-pdf-doc table.table-report col.col-code { width: 7%; }
        .loaner-pdf-doc table.table-report col.col-name { width: 16%; }
        .loaner-pdf-doc table.table-report col.col-pan { width: 9%; }
        .loaner-pdf-doc table.table-report col.col-amt { width: 8%; }
        .loaner-pdf-doc table.table-report col.col-city { width: 8%; }
        .loaner-pdf-doc table.table-report td.col-name,
        .loaner-pdf-doc table.table-report td.col-city {
          white-space: normal;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .loaner-pdf-doc table.table-report td.col-code,
        .loaner-pdf-doc table.table-report td.col-pan {
          white-space: nowrap;
          font-size: 7px;
        }
        .loaner-pdf-doc table.table-report td.amount {
          font-size: 7px;
          padding-left: 2px;
          padding-right: 2px;
        }
        .loaner-pdf-doc table.table-report thead th {
          font-size: 6.5px;
          padding: 5px 2px;
          line-height: 1.2;
          white-space: normal;
          word-wrap: break-word;
        }
      </style>
      <div class="report-topbar">
        <div class="kicker">INCOME TAX REPORT</div>
        <h1>${title.toUpperCase()}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr>
            <td class="lbl">Financial year</td>
            <td class="val">${fy}</td>
            <td class="lbl">Period</td>
            <td class="val">${period}</td>
          </tr>
          <tr>
            <td class="lbl">Schedule</td>
            <td class="val">${schedule}</td>
            <td class="lbl">Rows</td>
            <td class="val">${rows.length}</td>
          </tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report">
        <colgroup>
          <col class="col-code" />
          <col class="col-name" />
          <col class="col-pan" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-amt" />
          <col class="col-city" />
        </colgroup>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>PAN</th>
            <th class="amount">Opening</th>
            <th class="amount">Credit</th>
            <th class="amount">Cr.Int</th>
            <th class="amount">Tot.Cr</th>
            <th class="amount">Debit</th>
            <th class="amount">TDS</th>
            <th class="amount">Tot.Dr</th>
            <th class="amount">Closing</th>
            <th>City</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="12">No rows</td></tr>'}${totalRow}</tbody>
      </table>

      <div class="report-foot">Loaner accounts (code starts with L). VFP LOANLST / reports/loanlst.frx.</div>
    </div>
  `;
}

function buildPurchaseTdsReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const isDetail = metadata.reportMode === 'detail' || metadata.reportTitle?.includes('Detail');
  const isSale = String(metadata.reportTitle || '').toLowerCase().includes('sale');
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || (isDetail ? 'Party Wise Purchase Detail (TDS)' : 'Party Wise Purchase Summary (TDS)'));
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const party = escHtml(metadata.partyFilter || 'All parties');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const detailCols = isSale
    ? ['CODE', 'NAME', 'PAN', 'DOC_DATE', 'DOC_NO', 'TYPE', 'B_TYPE', 'AMOUNT', 'TDS_ON_AMT', 'TDS_PER', 'TDS_AMT', 'CITY', 'STATE']
    : ['CODE', 'NAME', 'PAN', 'DOC_DATE', 'DOC_NO', 'TYPE', 'AMOUNT', 'TDS_ON_AMT', 'TDS_PER', 'TDS_AMT', 'CITY', 'STATE'];
  const summaryCols = ['CODE', 'NAME', 'PAN', 'ADD1', 'CITY', 'STATE', 'AMOUNT', 'TDS_ON_AMT', 'TDS_PER', 'TDS_AMT'];
  const cols = isDetail ? detailCols : summaryCols;
  const labels = {
    CODE: 'Code',
    NAME: 'Name',
    PAN: 'PAN',
    ADD1: 'Address',
    CITY: 'City',
    STATE: 'State',
    R_DATE: 'R Date',
    R_NO: 'R No',
    TYPE: 'Type',
    AMOUNT: 'Amount',
    TDS_ON_AMT: 'TDS On Amt',
    TDS_PER: 'TDS %',
    TDS_AMT: 'TDS Amt',
  };
  const amtCols = new Set(['AMOUNT', 'TDS_ON_AMT', 'TDS_PER', 'TDS_AMT']);

  const groupedRows =
    isDetail && rows.length
      ? (() => {
          const out = [];
          let partyKey = null;
          let partyLabel = '';
          let subtotal = { AMOUNT: 0, TDS_ON_AMT: 0, TDS_AMT: 0 };
          const pushSubtotal = () => {
            if (!partyKey) return;
            out.push({
              _rowType: 'partyTotal',
              _partyLabel: partyLabel,
              AMOUNT: subtotal.AMOUNT,
              TDS_ON_AMT: subtotal.TDS_ON_AMT,
              TDS_AMT: subtotal.TDS_AMT,
            });
          };
          rows.forEach((r) => {
            const code = String(r?.CODE ?? '').trim();
            const name = String(r?.NAME ?? '').trim();
            const key = `${code}||${name}`;
            if (partyKey !== null && key !== partyKey) {
              pushSubtotal();
              subtotal = { AMOUNT: 0, TDS_ON_AMT: 0, TDS_AMT: 0 };
            }
            partyKey = key;
            partyLabel = `${code}${name ? ` - ${name}` : ''}`.trim();
            subtotal.AMOUNT += Number(r?.AMOUNT ?? 0);
            subtotal.TDS_ON_AMT += Number(r?.TDS_ON_AMT ?? 0);
            subtotal.TDS_AMT += Number(r?.TDS_AMT ?? 0);
            out.push({ ...r, _rowType: 'detail' });
          });
          pushSubtotal();
          return out;
        })()
      : rows;

  const body = groupedRows
    .map((r) => {
      if (r?._rowType === 'partyTotal') {
        const subtotalCells = cols
          .map((c, idx) => {
            if (idx === 0) return `<td><strong>${escHtml(`${r._partyLabel} TOTAL`)}</strong></td>`;
            if (c === 'AMOUNT') return `<td class="amount"><strong>${formatAmtPdf(r.AMOUNT)}</strong></td>`;
            if (c === 'TDS_ON_AMT') return `<td class="amount"><strong>${formatAmtPdf(r.TDS_ON_AMT)}</strong></td>`;
            if (c === 'TDS_AMT') return `<td class="amount"><strong>${formatAmtPdf(r.TDS_AMT)}</strong></td>`;
            if (amtCols.has(c)) return '<td class="amount"></td>';
            return '<td></td>';
          })
          .join('');
        return `<tr class="party-subtotal">${subtotalCells}</tr>`;
      }
      const tds = cols
        .map((c) => {
          const val = r?.[c];
          const cls = amtCols.has(c) ? 'amount' : '';
          const cell = amtCols.has(c) ? formatAmtPdf(val) : escHtml(val ?? '');
          return `<td class="${cls}">${cell}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');

  const totals = rows.reduce(
    (acc, r) => {
      acc.AMOUNT += Number(r?.AMOUNT ?? 0);
      acc.TDS_ON_AMT += Number(r?.TDS_ON_AMT ?? 0);
      acc.TDS_AMT += Number(r?.TDS_AMT ?? 0);
      return acc;
    },
    { AMOUNT: 0, TDS_ON_AMT: 0, TDS_AMT: 0 }
  );

  const totalRow = rows.length
    ? `<tr class="report-grand-total">${cols
        .map((c, idx) => {
          if (idx === 0) return '<td colspan="1" class="lbl-total">TOTAL</td>';
          if (c === 'AMOUNT') return `<td class="amount">${formatAmtPdf(totals.AMOUNT)}</td>`;
          if (c === 'TDS_ON_AMT') return `<td class="amount">${formatAmtPdf(totals.TDS_ON_AMT)}</td>`;
          if (c === 'TDS_AMT') return `<td class="amount">${formatAmtPdf(totals.TDS_AMT)}</td>`;
          if (amtCols.has(c)) return '<td class="amount"></td>';
          return '<td></td>';
        })
        .join('')}</tr>`
    : '';

  const head = cols.map((c) => `<th class="${amtCols.has(c) ? 'amount' : ''}">${labels[c] || c}</th>`).join('');

  return `
    <div class="report-doc purchase-tds-pdf-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .purchase-tds-pdf-doc { padding: 4px 6px 10px; }
        .purchase-tds-pdf-doc table.table-report { width: 100%; font-size: 7.5px; table-layout: auto; }
        .purchase-tds-pdf-doc table.table-report td.amount,
        .purchase-tds-pdf-doc table.table-report th.amount { text-align: right; }
        .purchase-tds-pdf-doc .party-subtotal td { background: #fef3c7; font-weight: 700; }
      </style>
      <div class="report-topbar">
        <div class="kicker">GST REPORT</div>
        <h1>${title.toUpperCase()}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr>
            <td class="lbl">Financial year</td>
            <td class="val">${fy}</td>
            <td class="lbl">Period</td>
            <td class="val">${period}</td>
          </tr>
          <tr>
            <td class="lbl">Party</td>
            <td class="val" colspan="3">${party}</td>
          </tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated} · <strong>Rows:</strong> ${rows.length}</div>
      </div>
      <table class="table-report">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${cols.length}">No rows</td></tr>`}${totalRow}</tbody>
      </table>
      <div class="report-foot">VFP DO FORM tcs_rpt WITH ${isSale ? (isDetail ? '5' : '6') : isDetail ? '3' : '4'} — ${isSale ? 'SALE TDS' : 'PURCHASE NTDS'} fields.</div>
    </div>
  `;
}

function buildLabourReportHtml(data, metadata = {}) {
  const rows = sortLabourRowsByVrDate(Array.isArray(data) ? data : []);
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Labour Report');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const isGrand = (r) =>
    Boolean(r?._isGrandTotal) ||
    String(r?.VR_DATE ?? r?.vr_date ?? '').toUpperCase().includes('GRAND TOTAL');

  const groupHead = LABOUR_REPORT_GROUPS.map(
    (g) => `<th colspan="${labourGroupColSpan(g)}" class="labour-group">${escHtml(g.label)}</th>`
  ).join('');

  const subHead = LABOUR_REPORT_GROUPS.map((g) =>
    g.pairs
      .map(
        (p) =>
          `<th class="amount">${escHtml(p.qtyLabel)}</th><th class="amount">${escHtml(p.amtLabel)}</th>`
      )
      .join('')
  ).join('');

  const body = rows
    .map((r) => {
      const grand = isGrand(r);
      const dateLabel = grand
        ? 'GRAND TOTAL'
        : escHtml(formatLedgerDateDisplay(labourRowValue(r, 'VR_DATE')) || String(labourRowValue(r, 'VR_DATE') ?? ''));
      const tot = Number(labourRowValue(r, 'TOT_AMT')) || labourTotAmt(r);
      const cells = LABOUR_REPORT_GROUPS.map((g) =>
        g.pairs
          .map(
            (p) =>
              `<td class="amount">${escHtml(fmtLabourQty(labourRowValue(r, p.qty)))}</td><td class="amount">${escHtml(fmtLabourAmt(labourRowValue(r, p.amt)))}</td>`
          )
          .join('')
      ).join('');
      return `<tr class="${grand ? 'report-grand-total' : ''}"><td class="labour-date">${dateLabel}</td>${cells}<td class="amount">${escHtml(fmtLabourAmt(tot))}</td></tr>`;
    })
    .join('');

  const colCount = 1 + LABOUR_REPORT_GROUPS.reduce((s, g) => s + labourGroupColSpan(g), 0) + 1;

  return `
    <div class="report-doc labour-pdf-doc">
      <style>${PDF_REPORT_STYLES}
        .labour-pdf-doc table.table-report { font-size: 7.5px; }
        .labour-pdf-doc .labour-group { background: #dbeafe; font-weight: 700; text-align: center; border-bottom: 1px solid #93c5fd; }
        .labour-pdf-doc th.amount { font-size: 7px; white-space: nowrap; }
        .labour-pdf-doc td.labour-date { white-space: nowrap; font-weight: 600; }
        .labour-pdf-doc .report-grand-total td { background: #1e3a5f; color: #fff; font-weight: 700; }
      </style>
      <div class="report-topbar">
        <div class="kicker">OTHER REPORT</div>
        <h1>${title.toUpperCase()}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated} &nbsp;|&nbsp; <strong>Rows:</strong> ${rows.length}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr><th rowspan="2" class="labour-date">Date</th>${groupHead}<th rowspan="2" class="amount">Tot.Amt.</th></tr>
          <tr>${subHead}</tr>
        </thead>
        <tbody>${body || `<tr><td colspan="${colCount}">No rows</td></tr>`}</tbody>
      </table>
      <div class="report-foot">Computer-generated labour report.</div>
    </div>
  `;
}

function buildIncomeTaxReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Income Tax Report');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const columns =
    Array.isArray(metadata.columns) && metadata.columns.length
      ? metadata.columns
      : rows.length
        ? Object.keys(rows[0])
            .filter((k) => !String(k).startsWith('_'))
            .map((key) => ({
              key,
              label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              type: /amt|amount|bal|weight|wgt|qty|qnty|rate|tot|op|dr|cr|tds|int|sale|pur|exp|comm|brok|net|apr|may|june|july|august|sep|october|nov|dec|jan|feb|mar/i.test(
                key
              )
                ? 'num'
                : 'text',
            }))
        : [];

  const colgroup = columns
    .map(() => `<col style="width:${Math.max(5, Math.floor(100 / Math.max(columns.length, 1)))}%" />`)
    .join('');

  const head = columns
    .map((c) => `<th class="${c.type === 'num' ? 'amount' : ''}">${escHtml(c.label || c.key)}</th>`)
    .join('');

  const tableRows = Array.isArray(metadata.tableRows) && metadata.tableRows.length ? metadata.tableRows : null;
  const sourceRows = tableRows || rows;
  const isGrandTotalRow = (r) =>
    Boolean(r?._isGrandTotal) ||
    String(r?.CMTH ?? r?.cmth ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(r?.R_DATE ?? r?.r_date ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(r?.BILL_DATE ?? r?.bill_date ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(r?.ITEM_NAME ?? r?.item_name ?? '').toUpperCase().includes('GRAND TOTAL') ||
    String(r?.NAME ?? r?.name ?? '').toUpperCase().includes('GRAND TOTAL');
  const isItemTotalRow = (r) => {
    if (Boolean(r?._isItemTotal)) return true;
    const fields = ['CMTH', 'NAME', 'ITEM_NAME'];
    return fields.some((k) => {
      const v = String(r?.[k] ?? r?.[k?.toLowerCase?.()] ?? '').toUpperCase();
      return v === 'ITEM TOTAL';
    });
  };
  const isBrokerTotalRow = (r) => {
    if (Boolean(r?._isBrokerTotal)) return true;
    const fields = ['CMTH', 'NAME', 'ITEM_NAME'];
    return fields.some((k) => {
      const v = String(r?.[k] ?? r?.[k?.toLowerCase?.()] ?? '').toUpperCase();
      return v === 'BROKER TOTAL';
    });
  };
  const isPartyTotalRow = (r) => {
    if (Boolean(r?._isPartyTotal)) return true;
    const fields = ['CMTH', 'R_DATE', 'BILL_DATE', 'ITEM_NAME', 'NAME', 'VR_DATE'];
    return fields.some((k) => {
      const v = String(r?.[k] ?? r?.[k?.toLowerCase?.()] ?? '').toUpperCase();
      return v === 'PARTY TOTAL' || v === 'CODE TOTAL' || v === 'CITY TOTAL';
    });
  };
  const dataRows = sourceRows.filter(
    (r) =>
      r._type !== 'group' &&
      r._type !== 'partyGroup' &&
      r._type !== 'subtotal' &&
      !isGrandTotalRow(r) &&
      !isItemTotalRow(r) &&
      !isPartyTotalRow(r)
  );
  const hasGrandTotal = sourceRows.some(isGrandTotalRow);

  const renderDataCells = (r) =>
    columns
      .map((c) => {
        if (c.type === 'partyBlock') {
          const name = escHtml(String(r[c.key] ?? r[c.key?.toLowerCase?.()] ?? '').trim());
          const subs = (c.subKeys || [])
            .map((k) => String(r[k] ?? r[k?.toLowerCase?.()] ?? '').trim())
            .filter(Boolean)
            .map((line) => `<div class="itax-party-sub">${escHtml(line)}</div>`)
            .join('');
          const inner = `${name ? `<div class="itax-party-name">${name}</div>` : ''}${subs}`;
          return `<td class="itax-party-cell">${inner}</td>`;
        }
        const raw = r[c.key] ?? r[c.key?.toLowerCase?.()];
        const val =
          c.type === 'num'
            ? formatAmtPdf(raw, c.decimals)
            : c.type === 'date'
              ? escHtml(formatLedgerDateDisplay(raw))
              : escHtml(raw ?? '');
        return `<td class="${c.type === 'num' ? 'amount' : ''}">${val}</td>`;
      })
      .join('');

  const renderPartyGroupHeaderPdf = (row) => {
    const code = escHtml(
      String(row.BK_CODE ?? row.bk_code ?? row.SUP_CODE ?? row.sup_code ?? row.CODE ?? row.code ?? '').trim()
    );
    const name = escHtml(
      String(row.BNAME ?? row.bname ?? row.BK_NAME ?? row.bk_name ?? row.NAME ?? row.name ?? '').trim()
    );
    const minimal = Boolean(metadata.partyGroupHeaderMinimal);
    const subs = minimal
      ? ''
      : ['ADD1', 'ADD2', 'ADD3', 'CITY', 'PAN', 'GST_NO']
          .map((k) => String(row[k] ?? '').trim())
          .filter(Boolean)
          .map((line) => `<div class="itax-party-sub">${escHtml(line)}</div>`)
          .join('');
    return `<div class="itax-party-name">${[code, name].filter(Boolean).join(' ')}</div>${subs}`;
  };

  const body = sourceRows
    .map((r) => {
      if (r._type === 'partyGroup') {
        return `<tr class="itax-party-group"><td colspan="${columns.length}"><div class="itax-party-cell">${renderPartyGroupHeaderPdf(r.partyRow || r)}</div></td></tr>`;
      }
      if (r._type === 'group') {
        return `<tr class="itax-schedule-group"><td colspan="${columns.length}">${escHtml(r.label || '')}</td></tr>`;
      }
      const grand = isGrandTotalRow(r);
      const itemTotal = isItemTotalRow(r);
      const brokerTotal = isBrokerTotalRow(r);
      const partyTotal = isPartyTotalRow(r);
      const rowKind = String(r?._ROW_KIND ?? '').toLowerCase();
      const rowClass = grand
        ? 'report-grand-total'
        : rowKind === 'day_close'
          ? 'itax-book-day-close'
          : rowKind === 'day_total'
            ? 'itax-book-day-total'
            : rowKind === 'cash_open'
              ? 'itax-book-day-open'
              : brokerTotal
          ? 'itax-broker-total'
          : partyTotal
            ? 'itax-party-total'
            : itemTotal
              ? 'itax-item-total'
              : '';
      return `<tr class="${rowClass}">${renderDataCells(r)}</tr>`;
    })
    .join('');

  const totals = {};
  columns.forEach((c) => {
    if (c.type !== 'num') return;
    totals[c.key] = dataRows.reduce((s, r) => s + Number(r[c.key] ?? r[c.key?.toLowerCase?.()] ?? 0), 0);
  });
  const firstNumIdx = columns.findIndex((c) => c.type === 'num');
  const totalRow =
    !hasGrandTotal && dataRows.length && firstNumIdx >= 0
      ? `<tr class="report-grand-total"><td colspan="${firstNumIdx}" class="lbl-total">TOTAL</td>${columns
          .slice(firstNumIdx)
          .map((c) =>
            c.type === 'num'
              ? `<td class="amount">${formatAmtPdf(totals[c.key])}</td>`
              : '<td></td>'
          )
          .join('')}</tr>`
      : '';

  return `
    <div class="report-doc itax-pdf-doc">
      <style>${PDF_REPORT_STYLES}
        .itax-pdf-doc .itax-party-cell { white-space: normal; font-size: 9px; vertical-align: top; }
        .itax-pdf-doc .itax-party-name { font-weight: 700; }
        .itax-pdf-doc .itax-party-sub { color: #444; font-size: 8px; line-height: 1.25; }
        .itax-pdf-doc .itax-schedule-group td { background: #e8eef5; font-weight: 700; padding: 4px 6px; border-top: 2px solid #9ca3af; }
        .itax-pdf-doc .itax-party-group td { background: #e8eef5; font-weight: 700; padding: 4px 6px; border-top: 2px solid #9ca3af; }
        .itax-pdf-doc .itax-item-total td { background: #e2e8f0; font-weight: 700; border-top: 1px solid #94a3b8; }
        .itax-pdf-doc .itax-broker-total td { background: #ecfdf5; font-weight: 700; border-top: 1px solid #86efac; }
        .itax-pdf-doc .itax-party-total td { background: #dbeafe; font-weight: 700; border-top: 1px solid #93c5fd; }
        .itax-pdf-doc .itax-book-day-open td { background: #f8fafc; font-weight: 600; }
        .itax-pdf-doc .itax-book-day-total td { background: #e2e8f0; font-weight: 700; border-top: 1px solid #94a3b8; }
        .itax-pdf-doc .itax-book-day-close td { background: #f1f5f9; font-weight: 800; border-top: 1px solid #64748b; }
      </style>
      <div class="report-topbar">
        <div class="kicker">INCOME TAX REPORT</div>
        <h1>${title.toUpperCase()}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated} &nbsp;|&nbsp; <strong>Rows:</strong> ${rows.length}</div>
      </div>
      <table class="table-report">
        <colgroup>${colgroup}</colgroup>
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${columns.length || 1}">No rows</td></tr>`}${totalRow}</tbody>
      </table>
      <div class="report-foot">Computer-generated income tax report.</div>
    </div>
  `;
}

function buildGstStateMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'GST State Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.['STATE CODE'] ?? r?.STATE_CODE ?? r?.state_code ?? '')}</td>
        <td>${escHtml(r?.STATE ?? r?.state ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .gststate-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .gststate-pdf .gststate-header { text-align: center; margin-bottom: 10px; }
        .gststate-pdf .gststate-company { font-size: 16px; font-weight: 700; text-transform: uppercase; }
        .gststate-pdf .gststate-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .gststate-pdf .gststate-period { font-size: 11px; margin-top: 4px; color: #444; }
        .gststate-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .gststate-pdf .table-report th, .gststate-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; }
        .gststate-pdf .table-report thead th { background: #f4f4f4; text-align: left; }
      </style>
      <div class="gststate-pdf report-doc">
        <div class="gststate-header">
          <div class="gststate-company">${company}</div>
          <div class="gststate-title">${title}</div>
          <div class="gststate-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>State_Code</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="2">No rows</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildLocBtypeMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Location Wise BType');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.['B TYPE'] ?? r?.B_TYPE ?? r?.b_type ?? '')}</td>
        <td>${escHtml(r?.['BILL INIT'] ?? r?.BILL_INIT ?? r?.bill_init ?? '')}</td>
        <td>${escHtml(r?.['FIN YEAR'] ?? r?.FIN_YEAR ?? r?.fin_year ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .locbtype-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .locbtype-pdf .locbtype-header { text-align: center; margin-bottom: 10px; }
        .locbtype-pdf .locbtype-company { font-size: 16px; font-weight: 700; text-transform: uppercase; }
        .locbtype-pdf .locbtype-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .locbtype-pdf .locbtype-period { font-size: 11px; margin-top: 4px; color: #444; }
        .locbtype-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .locbtype-pdf .table-report th, .locbtype-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; }
        .locbtype-pdf .table-report thead th { background: #f4f4f4; text-align: left; }
      </style>
      <div class="locbtype-pdf report-doc">
        <div class="locbtype-header">
          <div class="locbtype-company">${company}</div>
          <div class="locbtype-title">${title}</div>
          <div class="locbtype-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>B_Type</th>
              <th>Bill_Init</th>
              <th>Fin_Year</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="3">No rows</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildSaleCondMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Sale Bill Condition');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td class="num">${escHtml(r?.NO ?? r?.no ?? '')}</td>
        <td>${escHtml(r?.COND ?? r?.cond ?? r?.Condition ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .salecond-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .salecond-pdf .salecond-header { text-align: center; margin-bottom: 10px; }
        .salecond-pdf .salecond-company { font-size: 16px; font-weight: 700; text-transform: uppercase; }
        .salecond-pdf .salecond-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .salecond-pdf .salecond-period { font-size: 11px; margin-top: 4px; color: #444; }
        .salecond-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .salecond-pdf .table-report th, .salecond-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; vertical-align: top; }
        .salecond-pdf .table-report thead th { background: #f4f4f4; text-align: left; }
        .salecond-pdf .table-report td.num, .salecond-pdf .table-report th.num { text-align: center; width: 36px; }
        .salecond-pdf .table-report td:last-child { word-break: break-word; }
      </style>
      <div class="salecond-pdf report-doc">
        <div class="salecond-header">
          <div class="salecond-company">${company}</div>
          <div class="salecond-title">${title}</div>
          <div class="salecond-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Cond</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="2">No conditions</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildPurExpMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Purchase Exp Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.EXP_NAME ?? r?.exp_name ?? '')}</td>
        <td class="num">${escHtml(r?.EXP_RATE ?? r?.exp_rate ?? '')}</td>
        <td>${escHtml(r?.CAL ?? r?.cal ?? '')}</td>
        <td>${escHtml(r?.CODE ?? r?.code ?? '')}</td>
        <td>${escHtml(r?.AC_NAME ?? r?.ac_name ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .purexp-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .purexp-pdf .purexp-header { text-align: center; margin-bottom: 10px; }
        .purexp-pdf .purexp-company { font-size: 16px; font-weight: 700; text-transform: uppercase; }
        .purexp-pdf .purexp-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .purexp-pdf .purexp-period { font-size: 11px; margin-top: 4px; color: #444; }
        .purexp-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .purexp-pdf .table-report th, .purexp-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; }
        .purexp-pdf .table-report thead th { background: #f4f4f4; text-align: left; }
        .purexp-pdf .table-report td.num, .purexp-pdf .table-report th.num { text-align: right; }
      </style>
      <div class="purexp-pdf report-doc">
        <div class="purexp-header">
          <div class="purexp-company">${company}</div>
          <div class="purexp-title">${title}</div>
          <div class="purexp-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Exp_name</th>
              <th class="num">Exp_rate</th>
              <th>CAL</th>
              <th>Code</th>
              <th>A/c name</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="5">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildMarkaMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Marka Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.MARKA ?? r?.marka ?? '')}</td>
        <td class="num">${escHtml(r?.MIN_RATE ?? r?.min_rate ?? '')}</td>
        <td class="num">${escHtml(r?.MAX_RATE ?? r?.max_rate ?? '')}</td>
        <td class="num">${escHtml(r?.LAB_RATE ?? r?.lab_rate ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .marka-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .marka-pdf .marka-header { text-align: center; margin-bottom: 10px; }
        .marka-pdf .marka-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .marka-pdf .marka-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .marka-pdf .marka-period { font-size: 11px; margin-top: 4px; color: #444; }
        .marka-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .marka-pdf .table-report th, .marka-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; }
        .marka-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
        .marka-pdf .table-report td.num, .marka-pdf .table-report th.num { text-align: right; }
      </style>
      <div class="marka-pdf report-doc">
        <div class="marka-header">
          <div class="marka-company">${company}</div>
          <div class="marka-title">${title}</div>
          <div class="marka-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Marka</th>
              <th class="num">Min.Rate</th>
              <th class="num">Max.Rate</th>
              <th class="num">Lab.Rate</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="4">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

const GODOWN_MASTER_PDF_COLUMNS = [
  ['GOD_CODE', 'God.Code'],
  ['GOD_NAME', 'God.Name'],
  ['GOD_NAME1', 'Company'],
  ['GOD_ADD1', 'Address 1'],
  ['GOD_ADD2', 'Address 2'],
  ['GOD_LOCATION', 'Location'],
  ['GOD_PIN_CODE', 'Pin'],
  ['GOD_STATE_CODE', 'St.Code'],
  ['GOD_STATE', 'State Name'],
  ['GOD_GST_NO', 'GST No.'],
  ['GOD_TEL_NO_1', 'Tel 1'],
  ['GOD_TEL_NO_2', 'Tel 2'],
  ['GOD_FSSAI_NO', 'FSSAI'],
  ['GOD_B_TYPE', 'Bill Type'],
  ['GOD_CODE_MAIN', 'Main God.'],
];

function godownMasterPdfCell(r, key) {
  const aliases =
    key === 'GOD_STATE' ? ['STATE', 'state'] : key === 'GOD_STATE_CODE' ? ['STATE_CODE', 'state_code'] : [];
  const keys = [key, key.toLowerCase(), ...aliases];
  for (const k of keys) {
    const v = r?.[k];
    if (v != null && String(v).trim() !== '') return escHtml(v);
  }
  return '';
}

function buildGodownMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Godown Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');
  const colCount = GODOWN_MASTER_PDF_COLUMNS.length;

  const headCells = GODOWN_MASTER_PDF_COLUMNS.map(([, label]) => `<th>${escHtml(label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${GODOWN_MASTER_PDF_COLUMNS.map(([key]) => `<td>${godownMasterPdfCell(r, key)}</td>`).join('')}</tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .godm-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .godm-pdf .godm-header { text-align: center; margin-bottom: 10px; }
        .godm-pdf .godm-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .godm-pdf .godm-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .godm-pdf .godm-period { font-size: 11px; margin-top: 4px; color: #444; }
        .godm-pdf .table-report { width: 100%; table-layout: fixed; font-size: 7px; border-collapse: collapse; }
        .godm-pdf .table-report th, .godm-pdf .table-report td { border: 1px solid #ddd; padding: 2px 3px; line-height: 1.1; vertical-align: top; word-break: break-word; }
        .godm-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
      </style>
      <div class="godm-pdf report-doc">
        <div class="godm-header">
          <div class="godm-company">${company}</div>
          <div class="godm-title">${title}</div>
          <div class="godm-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>${headCells}</tr>
          </thead>
          <tbody>${body || `<tr><td colspan="${colCount}">(No rows)</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildCostMastReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Cost Centre Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.COST_CODE ?? r?.cost_code ?? '')}</td>
        <td>${escHtml(r?.COST_NAME ?? r?.cost_name ?? '')}</td>
        <td>${escHtml(r?.CODE ?? r?.code ?? '')}</td>
        <td>${escHtml(r?.AC_NAME ?? r?.ac_name ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .costm-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .costm-pdf .costm-header { text-align: center; margin-bottom: 10px; }
        .costm-pdf .costm-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .costm-pdf .costm-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .costm-pdf .costm-period { font-size: 11px; margin-top: 4px; color: #444; }
        .costm-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .costm-pdf .table-report th, .costm-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; }
        .costm-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
      </style>
      <div class="costm-pdf report-doc">
        <div class="costm-header">
          <div class="costm-company">${company}</div>
          <div class="costm-title">${title}</div>
          <div class="costm-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Cost code</th>
              <th>Name</th>
              <th>A/c code</th>
              <th>A/c name</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="4">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildCatMastReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Item Category Master');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r?.CAT_CODE ?? r?.cat_code ?? r?.CATEGORY ?? '')}</td>
        <td>${escHtml(r?.CAT_NAME ?? r?.cat_name ?? r?.NAME ?? '')}</td>
      </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .catm-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .catm-pdf .catm-header { text-align: center; margin-bottom: 10px; }
        .catm-pdf .catm-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .catm-pdf .catm-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .catm-pdf .catm-period { font-size: 11px; margin-top: 4px; color: #444; }
        .catm-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .catm-pdf .table-report th, .catm-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; }
        .catm-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
      </style>
      <div class="catm-pdf report-doc">
        <div class="catm-header">
          <div class="catm-company">${company}</div>
          <div class="catm-title">${title}</div>
          <div class="catm-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Category</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="2">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

function buildAccountMasterReportHtml(data, metadata = {}) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'A/c Master List');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || metadata.endDate || '—');

  const grouped = new Map();
  for (const r of rows) {
    const schRaw = Number(r?.SCHEDULE ?? r?.SCH_NO ?? r?.schedule ?? r?.sch_no);
    const schNo = Number.isFinite(schRaw) ? schRaw.toFixed(2) : '';
    const schName = String(r?.SCH_NAME ?? r?.sch_name ?? '').trim();
    const key = `${schNo}||${schName}`;
    if (!grouped.has(key)) grouped.set(key, { schNo, schName, rows: [] });
    grouped.get(key).rows.push(r);
  }

  const groups = Array.from(grouped.values()).sort((a, b) => {
    const an = Number(a.schNo);
    const bn = Number(b.schNo);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a.schName).localeCompare(String(b.schName));
  });

  const body = groups
    .map((g) => {
      const schedHead = `${g.schNo || '—'} ${g.schName || ''}`.trim();
      const detailRows = g.rows
        .map(
          (r) => `<tr>
        <td>${escHtml(r?.CODE ?? r?.code ?? '')}</td>
        <td>${escHtml(r?.NAME ?? r?.name ?? '')}</td>
        <td>${escHtml(r?.CITY ?? r?.city ?? '')}</td>
        <td>${escHtml(r?.GST_NO ?? r?.gst_no ?? '')}</td>
        <td>${escHtml(r?.PAN ?? r?.pan ?? '')}</td>
        <td>${escHtml(r?.L_C ?? r?.l_c ?? '')}</td>
      </tr>`
        )
        .join('');
      return `
        <tr class="acm-schedule-head"><td colspan="6">SCHEDULE: ${escHtml(schedHead || '—')}</td></tr>
        ${detailRows}
      `;
    })
    .join('');

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .acm-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .acm-pdf .acm-header { text-align: center; margin-bottom: 10px; }
        .acm-pdf .acm-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .acm-pdf .acm-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .acm-pdf .acm-period { font-size: 11px; margin-top: 4px; color: #444; }
        .acm-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; border-collapse: collapse; }
        .acm-pdf .table-report th, .acm-pdf .table-report td { border: 1px solid #ddd; padding: 3px 4px; line-height: 1.15; vertical-align: top; }
        .acm-pdf .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
        .acm-pdf .table-report .acm-schedule-head td {
          background: #e5e7eb;
          color: #111827;
          font-weight: 700;
          border-top: 2px solid #9ca3af;
          padding: 5px 6px;
        }
      </style>
      <div class="acm-pdf report-doc">
        <div class="acm-header">
          <div class="acm-company">${company}</div>
          <div class="acm-title">${title}</div>
          <div class="acm-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>City</th>
              <th>GST No</th>
              <th>PAN</th>
              <th>L/C</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="6">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

const VOUCHER_PRINT_STYLES = `
  .vou-print { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; max-width: 210mm; margin: 0 auto; }
  .vou-print-copy { padding: 8mm 10mm 10mm; page-break-inside: avoid; }
  .vou-print-copy + .vou-print-copy { border-top: 1px dashed #888; margin-top: 6mm; padding-top: 8mm; }
  .vou-print-comp { text-align: center; margin-bottom: 6px; }
  .vou-print-comp h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.02em; }
  .vou-print-comp .addr { font-size: 10px; line-height: 1.35; margin-top: 2px; }
  .vou-print-tax { font-size: 9px; line-height: 1.4; margin: 4px 0 6px; }
  .vou-print-title { text-align: center; font-size: 14px; font-weight: 700; margin: 6px 0 8px; letter-spacing: 0.06em; }
  .vou-print-meta { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 6px; }
  .vou-print-party { font-size: 10px; margin-bottom: 8px; line-height: 1.45; }
  .vou-print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .vou-print-table th, .vou-print-table td { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
  .vou-print-table th { background: #f3f3f3; font-weight: 700; }
  .vou-print-table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .vou-print-table tfoot td { font-weight: 700; }
  .vou-print-words { margin: 8px 0 10px; font-size: 10px; font-weight: 600; }
  .vou-print-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 18px; font-size: 10px; }
  .vou-print-sign { text-align: center; min-width: 120px; }
  .vou-print-sign .line { border-top: 1px solid #333; margin-top: 28px; padding-top: 3px; }
  .vou-print-for { text-align: right; font-size: 10px; margin-top: 8px; }
  .vou-print-part-code { font-weight: 700; }
  .vou-print-part-name { font-size: 10px; line-height: 1.35; }
  .vou-print-part-detail { font-size: 9px; color: #444; margin-top: 2px; }
`;

function fmtVouDate(d) {
  return escHtml(formatLedgerDateDisplay(d) || d || '');
}

function formatVoucherParticularsCell(ln) {
  const code = String(ln?.code ?? '').trim();
  const name = String(ln?.name ?? '').trim();
  const detail = String(ln?.detail ?? '').trim();
  const fallback = String(ln?.particulars ?? '').trim();
  const main = [code, name].filter(Boolean).join(' ');
  if (!main) return escHtml(fallback || detail);
  let html = `<div class="vou-print-part-name">${code ? `<span class="vou-print-part-code">${escHtml(code)}</span> ` : ''}${escHtml(name)}</div>`;
  if (detail && detail !== name && detail !== main && !main.includes(detail)) {
    html += `<div class="vou-print-part-detail">${escHtml(detail)}</div>`;
  }
  return html;
}

function buildVoucherSlipHtml(payload, metadata, company) {
  const lines = payload?.voucher_lines || [];
  let body = '';
  for (const ln of lines) {
    body += `<tr>
      <td>${formatVoucherParticularsCell(ln)}</td>
      <td class="num">${formatAmtPdf(ln.dr_amt)}</td>
      <td class="num">${formatAmtPdf(ln.cr_amt)}</td>
    </tr>`;
  }
  const t = payload?.totals || {};
  const words = escHtml(rupeesToWords(Math.max(t.dr || 0, t.cr || 0)));
  const cin = escHtml(company.cin || '');
  const gst = escHtml(company.gst || '');
  const addr = [company.add1, company.add2].filter(Boolean).map(escHtml).join(', ');
  const taxLines = [gst ? `GSTIN: ${gst}` : '', cin ? `CIN: ${cin}` : ''].filter(Boolean).join(' &nbsp;|&nbsp; ');
  const metaLeft = `Vr.Date: <strong>${fmtVouDate(metadata.vrDate)}</strong>`;
  const metaRight = `Vr.No.: <strong>${escHtml(metadata.vrNo)}</strong>`;

  return `
    <div class="vou-print-copy">
      <div class="vou-print-comp">
        <h1>${escHtml(company.companyName || metadata.companyName)}</h1>
        ${addr ? `<div class="addr">${addr}</div>` : ''}
      </div>
      <div class="vou-print-title">${escHtml(metadata.documentTitle)}</div>
      ${taxLines ? `<div class="vou-print-tax" style="text-align:center">${taxLines}</div>` : ''}
      <div class="vou-print-meta"><span>${metaLeft}</span><span>${metaRight}</span></div>
      <table class="vou-print-table">
        <thead><tr><th>PARTICULARS</th><th class="num">Dr.Amount</th><th class="num">Cr.Amount</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td class="num">${formatAmtPdf(t.dr)}</td>
            <td class="num">${formatAmtPdf(t.cr)}</td>
          </tr>
        </tfoot>
      </table>
      <div class="vou-print-words">${words}</div>
      <div class="vou-print-for">For ${escHtml(company.companyName || metadata.companyName)}</div>
      <div class="vou-print-foot">
        <div class="vou-print-sign"><div class="line">Receiver Signature</div></div>
        <div class="vou-print-sign"><div class="line">Checked By</div></div>
        <div class="vou-print-sign"><div class="line">Auth.Signatory</div></div>
      </div>
    </div>`;
}

function buildCashReceiptSlipHtml(payload, metadata, company) {
  const party = payload?.party || {};
  const lines = payload?.receipt_lines || [];
  let body = '';
  let totCash = 0;
  for (const ln of lines) {
    totCash += Number(ln.cash_received ?? 0) || 0;
    body += `<tr>
      <td>${fmtVouDate(ln.bill_date)}</td>
      <td class="num">${escHtml(ln.bill_no)}</td>
      <td class="num">${formatAmtPdf(ln.bill_amt)}</td>
      <td class="num">${formatAmtPdf(ln.int_amt)}</td>
      <td class="num">${formatAmtPdf(ln.total)}</td>
      <td class="num">${formatAmtPdf(ln.cash_received)}</td>
    </tr>`;
  }
  const words = escHtml(rupeesToWords(totCash || payload?.totals?.amount || 0));
  const taxLines = [
    company.cin ? `CIN: ${escHtml(company.cin)}` : '',
    company.pan ? `PAN: ${escHtml(company.pan)}` : '',
    company.gst ? `GSTIN: ${escHtml(company.gst)}` : '',
    company.fssai ? `FSSAI No. ${escHtml(company.fssai)}` : '',
  ]
    .filter(Boolean)
    .join('<br/>');
  const contact = [company.email, company.tel1, company.tel2].filter(Boolean).map(escHtml).join(' · ');
  const partyLine = `Party ${escHtml(party.code)} ${escHtml(party.name)} ${escHtml(party.city)}`.trim();
  const copyHtml = `
    <div class="vou-print-copy">
      <div class="vou-print-tax">${taxLines}</div>
      <div class="vou-print-comp">
        <h1>${escHtml(company.companyName || metadata.companyName)}</h1>
        ${contact ? `<div class="addr">${contact}</div>` : ''}
        ${[company.add1, company.add2].filter(Boolean).length ? `<div class="addr">${[company.add1, company.add2].map(escHtml).join(', ')}</div>` : ''}
      </div>
      <div class="vou-print-title">${escHtml(metadata.documentTitle)}</div>
      <div class="vou-print-meta">
        <span>Receipt Date: <strong>${fmtVouDate(metadata.vrDate)}</strong></span>
        <span>Receipt No.: <strong>${escHtml(metadata.receiptNo)}</strong></span>
      </div>
      <div class="vou-print-party">
        <div>${partyLine}</div>
        ${party.pan ? `<div>Pan: ${escHtml(party.pan)}</div>` : ''}
      </div>
      <table class="vou-print-table">
        <thead>
          <tr>
            <th>Bill Date</th><th class="num">Bill No.</th><th class="num">Bill Amount</th>
            <th class="num">Int. Amount</th><th class="num">Total</th><th class="num">Cash Received</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="5" class="num">TOTAL</td><td class="num">${formatAmtPdf(totCash)}</td></tr></tfoot>
      </table>
      <div class="vou-print-words">RS. ${words} ONLY</div>
      <div style="font-size:9px;margin-top:4px">E. &amp; O.E.</div>
      <div class="vou-print-for">For ${escHtml(company.companyName || metadata.companyName)}</div>
      <div class="vou-print-foot">
        <div>Prepared By <strong>${escHtml(metadata.preparedBy || '')}</strong></div>
        <div class="vou-print-sign"><div class="line">Auth. Signatory</div></div>
      </div>
    </div>`;
  return copyHtml + copyHtml;
}

function buildVoucherPrintHtml(payload, metadata) {
  const company = metadata?.company || {};
  const inner =
    metadata?.isReceipt || payload?.format === 'receipt'
      ? buildCashReceiptSlipHtml(payload, metadata, company)
      : buildVoucherSlipHtml(payload, metadata, company);
  return `
    <div class="vou-print report-doc">
      <style>${PDF_REPORT_STYLES}${VOUCHER_PRINT_STYLES}</style>
      ${inner}
    </div>`;
}

function buildSinglePurchaseOrderPrintCopy(order, company, metadata) {
  const h = order?.header || {};
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  const t = order?.totals || {};
  const compName = escHtml(company.companyName || metadata.companyName || '');
  const slogan = escHtml(company.billSlogan || '');
  const bHeader = escHtml(company.bHeader || '');
  const addr1 = escHtml(company.add1 || '');
  const addr2 = escHtml(company.add2 || '');
  const gst = escHtml(company.gst || '');
  const email = escHtml(company.email || '');
  const pan = escHtml(company.pan || '');
  const tel1 = escHtml(company.tel1 || '');
  const tel2 = escHtml(company.tel2 || '');
  const tel3 = escHtml(company.tel3 || '');
  const cin = escHtml(company.cin || '');
  const phLine = [tel1, tel2].filter(Boolean).join(', ');
  const partyCity = [h.add3, h.city].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
  const partyAddr = [h.add1, h.add2, partyCity].map((v) => String(v || '').trim()).filter(Boolean);

  let body = '';
  for (const ln of lines) {
    const unit = String(ln.status_unit || '').trim();
    const qtyLabel = unit ? `${formatAmtPdf(ln.qnty, 0)} ${escHtml(unit)}` : formatAmtPdf(ln.qnty, 0);
    const particulars = `${String(ln.trn_no ?? '').trim()} ${String(ln.item_name || '').trim()}`.trim();
    body += `<tr>
      <td>${escHtml(particulars)}</td>
      <td>${escHtml(ln.hsn_code || '')}</td>
      <td class="num">${qtyLabel}</td>
      <td class="num">${formatAmtPdf(ln.weight, 3)}</td>
      <td class="num">${formatAmtPdf(ln.rate)}</td>
      <td class="num">${formatAmtPdf(ln.amount)}</td>
    </tr>`;
  }

  const pmtDueRow =
    h.show_pmt_due !== false && h.pmt_due_date
      ? `<tr><td class="po-print-meta__label">Pmt. Due Date</td><td class="po-print-meta__val">${escHtml(toDisplayDate(h.pmt_due_date) || h.pmt_due_date)}</td></tr>`
      : '';

  return `
    <div class="po-print-copy">
      <table class="po-print-top">
        <tr>
          <td class="po-print-top__side">
            ${gst ? `<div>GSTIN: ${gst}</div>` : ''}
            ${email ? `<div>EMAIL: ${email}</div>` : ''}
            ${pan ? `<div>PAN: ${pan}</div>` : ''}
          </td>
          <td class="po-print-top__title">PURCHASE ORDER</td>
          <td class="po-print-top__side po-print-top__side--right">
            ${phLine ? `<div>PH: ${phLine}</div>` : ''}
            ${tel3 ? `<div>FAX: ${tel3}</div>` : ''}
            ${cin ? `<div>CIN: ${cin}</div>` : ''}
          </td>
        </tr>
      </table>
      <div class="po-print-company">
        ${slogan ? `<div class="po-print-slogan">${slogan}</div>` : ''}
        <div class="po-print-company__name">${compName}</div>
        ${bHeader ? `<div class="po-print-company__tag">${bHeader}</div>` : ''}
        ${addr1 ? `<div>${addr1}</div>` : ''}
        ${addr2 ? `<div>${addr2}</div>` : ''}
      </div>
      <div class="po-print-party-row">
        <div class="po-print-party">
          <div>M/s <strong>${escHtml(h.party_name || '')}</strong></div>
          ${partyAddr.map((line) => `<div>${escHtml(line)}</div>`).join('')}
          <div>Tel: ${escHtml(h.tel_no || '')}</div>
          <div>GSTIN: ${escHtml(h.gst_no || '')}</div>
          ${h.bk_name ? `<div>Broker: <strong>${escHtml(h.bk_name)}</strong></div>` : ''}
        </div>
        <table class="po-print-meta">
          <tr class="po-print-meta__head"><td class="po-print-meta__label">Order No.</td><td class="po-print-meta__val">${escHtml(h.so_no)}</td></tr>
          <tr class="po-print-meta__head"><td class="po-print-meta__label">Dated</td><td class="po-print-meta__val">${escHtml(toDisplayDate(h.so_date) || h.so_date)}</td></tr>
          <tr><td class="po-print-meta__label">Delv. Due Date</td><td class="po-print-meta__val">${escHtml(toDisplayDate(h.delv_date) || h.delv_date)}</td></tr>
          ${pmtDueRow}
        </table>
      </div>
      <table class="po-print-table">
        <thead>
          <tr>
            <th>Particulars</th>
            <th>HsnCode</th>
            <th class="num">Qty.</th>
            <th class="num">Weight</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td colspan="2"><strong>TOTAL</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.qnty, 0)}</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.weight, 3)}</strong></td>
            <td></td>
            <td class="num"><strong>${formatAmtPdf(t.amount)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <div class="po-print-footer">
        <div class="po-print-footer__left">
          ${h.po_no ? `<div>P.O.No.: ${escHtml(h.po_no)}</div>` : ''}
          ${h.p_condition ? `<div>Payment Condition: ${escHtml(h.p_condition)}</div>` : ''}
          ${h.delv_mth ? `<div>Delivery Month: ${escHtml(h.delv_mth)}</div>` : ''}
          ${h.remarks ? `<div>Remarks: ${escHtml(h.remarks)}</div>` : ''}
          ${h.remarks2 ? `<div>${escHtml(h.remarks2)}</div>` : ''}
          ${h.remarks3 ? `<div>${escHtml(h.remarks3)}</div>` : ''}
        </div>
        <div class="po-print-footer__sign">
          <div>For ${compName}</div>
          <div class="po-print-footer__sign-line">Auth.Signatory</div>
        </div>
      </div>
    </div>`;
}

const PO_PRINT_STYLES = `
  .po-print { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; }
  .po-print-copy { page-break-after: always; }
  .po-print-copy:last-child { page-break-after: auto; }
  .po-print-top { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  .po-print-top td { vertical-align: top; border: none; padding: 0 2px; font-size: 8.5px; line-height: 1.25; }
  .po-print-top__title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
  .po-print-top__side { width: 32%; }
  .po-print-top__side--right { text-align: right; }
  .po-print-company { text-align: center; margin: 2px 0 8px; line-height: 1.25; }
  .po-print-slogan { font-size: 9px; font-weight: 600; }
  .po-print-company__name { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .po-print-company__tag { font-size: 10px; font-weight: 700; margin-top: 1px; }
  .po-print-party-row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
  .po-print-party { flex: 1; min-width: 0; line-height: 1.35; font-size: 9.5px; }
  .po-print-meta { width: 190px; border-collapse: collapse; font-size: 9px; flex-shrink: 0; }
  .po-print-meta td { border: 1px solid #999; padding: 2px 5px; }
  .po-print-meta__head { background: #d9d9d9; }
  .po-print-meta__label { font-weight: 600; width: 52%; }
  .po-print-table { width: 100%; border-collapse: collapse; font-size: 9px; margin-top: 2px; }
  .po-print-table th, .po-print-table td { border: 1px solid #999; padding: 2px 4px; vertical-align: top; }
  .po-print-table thead th { background: #d9d9d9; font-weight: 700; }
  .po-print-table tfoot td { border-top: 2px solid #666; }
  .po-print-table .num { text-align: right; white-space: nowrap; }
  .po-print-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; font-size: 9px; line-height: 1.35; }
  .po-print-footer__left { flex: 1; min-width: 0; }
  .po-print-footer__sign { width: 180px; text-align: right; }
  .po-print-footer__sign-line { margin-top: 42px; font-weight: 600; }
`;

function buildPurchaseOrderPrintHtml(payload, metadata) {
  const company = metadata?.company || {};
  const orders = Array.isArray(payload?.orders)
    ? payload.orders
    : payload?.header
      ? [{ header: payload.header, lines: payload.lines || [], totals: payload.totals || {} }]
      : [];
  const copies = orders.map((order) => buildSinglePurchaseOrderPrintCopy(order, company, metadata)).join('');
  return `
    <div class="vou-print po-print report-doc">
      <style>${PDF_REPORT_STYLES}${PO_PRINT_STYLES}</style>
      ${copies || '<div class="voucher-help-modal__msg">No purchase orders to print.</div>'}
    </div>`;
}

function buildPurchaseOrderPendingSummaryHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'PENDING PURCHASE ORDER LIST');
  const period = escHtml(
    metadata.period || `FROM ${formatLedgerDateDisplay(payload?.s_date) || payload?.s_date || '—'} TO ${formatLedgerDateDisplay(payload?.e_date) || payload?.e_date || '—'}`
  );
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const grand = payload?.grand || {};

  const sumFields = (list, keys) => {
    const t = {};
    for (const k of keys) t[k] = 0;
    for (const r of list) for (const k of keys) t[k] += Number(r[k]) || 0;
    return t;
  };
  const qtyKeys = ['oqty', 'rqty', 'bqty', 'owgt', 'rwgt', 'bwgt'];

  let body = '';
  let currentCode = null;
  let currentItem = null;
  let itemRows = [];
  let supplierRows = [];

  const itemTotalRow = (list, label) => {
    const t = sumFields(list, qtyKeys);
    return `<tr class="po-pnd-total"><td colspan="5"><strong>${label}</strong></td>
      <td class="num">${formatAmtPdf(t.oqty, 0)}</td><td class="num">${formatAmtPdf(t.rqty, 0)}</td><td class="num">${formatAmtPdf(t.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(t.owgt, 3)}</td><td class="num">${formatAmtPdf(t.rwgt, 3)}</td><td class="num">${formatAmtPdf(t.bwgt, 3)}</td><td></td></tr>`;
  };

  const flushItem = () => {
    if (itemRows.length) body += itemTotalRow(itemRows, 'ITEM TOTAL');
    itemRows = [];
  };
  const flushSupplier = () => {
    flushItem();
    if (supplierRows.length) body += itemTotalRow(supplierRows, 'SUPPLIER TOTAL');
    supplierRows = [];
  };

  for (const r of rows) {
    if (currentCode !== r.code) {
      flushSupplier();
      currentCode = r.code;
      currentItem = null;
      supplierRows = [];
      body += `<tr class="po-pnd-party"><td colspan="11"><strong>${escHtml(r.name)}</strong>${r.bk_name ? ` &nbsp; Broker: ${escHtml(r.bk_name)}` : ''}${r.sup_name ? ` &nbsp; Supplier: ${escHtml(r.sup_name)}` : ''}</td></tr>`;
    }
    if (currentItem !== r.item_code) {
      flushItem();
      currentItem = r.item_code;
      itemRows = [];
    }
    itemRows.push(r);
    supplierRows.push(r);
    body += `<tr>
      <td>${escHtml(r.item_name)}</td>
      <td>${escHtml(r.loc_code)}</td>
      <td>${escHtml(r.god_code)}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.so_date) || r.so_date)}</td>
      <td class="num">${escHtml(r.so_no)}</td>
      <td class="num">${formatAmtPdf(r.oqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.rqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.owgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.rwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.bwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.rate)}</td>
    </tr>`;
    if (r.remarks || r.delv_mth) {
      body += `<tr class="po-pnd-sub"><td colspan="11">${r.remarks ? `Remarks: ${escHtml(r.remarks)}` : ''}${r.delv_mth ? ` &nbsp; Delv.Mth: ${escHtml(r.delv_mth)}` : ''}</td></tr>`;
    }
  }
  flushSupplier();

  return `
    <div class="report-doc po-pnd">
      <style>
        ${PDF_REPORT_STYLES}
        .po-pnd.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; font-size: 8.5px; }
        .po-pnd-header { text-align: center; margin-bottom: 8px; }
        .po-pnd-company { font-size: 14px; font-weight: 700; text-transform: uppercase; }
        .po-pnd-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
        .po-pnd-period { font-size: 9px; margin-top: 3px; }
        .po-pnd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .po-pnd-table th, .po-pnd-table td { border: 1px solid #bbb; padding: 2px 3px; vertical-align: top; word-break: break-word; }
        .po-pnd-table thead th { background: #d9d9d9; font-weight: 700; }
        .po-pnd-table .num { text-align: right; white-space: nowrap; }
        .po-pnd-party td { background: #eef2ff; font-weight: 600; }
        .po-pnd-total td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
        .po-pnd-sub td { font-size: 8px; color: #444; border-top: none; }
        .po-pnd-grand td { font-weight: 700; background: #e2e8f0; }
      </style>
      <div class="po-pnd report-doc">
        <div class="po-pnd-header">
          <div class="po-pnd-company">${company}</div>
          <div class="po-pnd-title">${title}</div>
          <div class="po-pnd-period">${period}</div>
        </div>
        <table class="po-pnd-table">
          <thead>
            <tr>
              <th rowspan="2">Item Name</th><th rowspan="2">Loc.</th><th rowspan="2">God.</th>
              <th rowspan="2">So.Date</th><th rowspan="2">So.No.</th>
              <th colspan="3">Qty.</th><th colspan="3">Weight</th><th rowspan="2">Rate</th>
            </tr>
            <tr>
              <th class="num">Oqty.</th><th class="num">SQty.</th><th class="num">BQty.</th>
              <th class="num">OWgt.</th><th class="num">SWgt.</th><th class="num">BWgt.</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="12">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr class="po-pnd-grand">
              <td colspan="5"><strong>TOTAL</strong></td>
              <td class="num">${formatAmtPdf(grand.oqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.rqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.bqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.owgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.rwgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.bwgt, 3)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function buildPurchaseOrderPendingDetailHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'PENDING PURCHASE ORDER LIST');
  const period = escHtml(
    metadata.period || `FROM ${formatLedgerDateDisplay(payload?.s_date) || payload?.s_date || '—'} TO ${formatLedgerDateDisplay(payload?.e_date) || payload?.e_date || '—'}`
  );
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const grand = payload?.grand || {};
  const qtyKeys = ['so_qty', 'sl_qty', 'bqty', 'so_wgt', 'sl_wgt', 'bwgt'];

  const sumFields = (list, keys) => {
    const t = {};
    for (const k of keys) t[k] = 0;
    for (const r of list) for (const k of keys) t[k] += Number(r[k]) || 0;
    return t;
  };

  let body = '';
  let currentCode = null;
  let currentSo = null;
  let orderRows = [];
  let supplierRows = [];

  const totalRow = (list, label, colspan = 7) => {
    const t = sumFields(list, qtyKeys);
    return `<tr class="po-pnd-total"><td colspan="${colspan}"><strong>${label}</strong></td>
      <td class="num">${formatAmtPdf(t.so_qty, 0)}</td><td class="num">${formatAmtPdf(t.sl_qty, 0)}</td><td class="num">${formatAmtPdf(t.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(t.so_wgt, 3)}</td><td class="num">${formatAmtPdf(t.sl_wgt, 3)}</td><td class="num">${formatAmtPdf(t.bwgt, 3)}</td><td></td><td></td></tr>`;
  };

  const flushOrder = () => {
    if (orderRows.length) body += totalRow(orderRows, `ORDER TOTAL — ${currentSo}`);
    orderRows = [];
  };
  const flushSupplier = () => {
    flushOrder();
    if (supplierRows.length) body += totalRow(supplierRows, 'SUPPLIER TOTAL');
    supplierRows = [];
  };

  for (const r of rows) {
    if (currentCode !== r.code) {
      flushSupplier();
      currentCode = r.code;
      currentSo = null;
      supplierRows = [];
      body += `<tr class="po-pnd-party"><td colspan="14"><strong>${escHtml(r.name)}</strong></td></tr>`;
    }
    if (currentSo !== null && r.so_no !== currentSo) flushOrder();
    currentSo = r.so_no;
    orderRows.push(r);
    supplierRows.push(r);
    const billNo = r.m_type === 1 ? '' : r.bill_no || String(r.r_no || '');
    body += `<tr>
      <td>${escHtml(r.item_name)}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.so_date) || r.so_date)}</td>
      <td class="num">${escHtml(r.so_no)}</td>
      <td>${escHtml(r.loc_code)}</td>
      <td>${escHtml(r.god_code)}</td>
      <td>${escHtml(billNo)}</td>
      <td>${escHtml(r.status)}</td>
      <td class="num">${formatAmtPdf(r.so_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.sl_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.so_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.sl_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.bwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.rate)}</td>
      <td>${escHtml(r.bk_name)}</td>
    </tr>`;
  }
  flushSupplier();

  return `
    <div class="report-doc po-pnd">
      <style>
        ${PDF_REPORT_STYLES}
        .po-pnd.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; font-size: 8px; }
        .po-pnd-header { text-align: center; margin-bottom: 8px; }
        .po-pnd-company { font-size: 14px; font-weight: 700; text-transform: uppercase; }
        .po-pnd-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
        .po-pnd-period { font-size: 9px; margin-top: 3px; }
        .po-pnd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .po-pnd-table th, .po-pnd-table td { border: 1px solid #bbb; padding: 2px 3px; vertical-align: top; word-break: break-word; }
        .po-pnd-table thead th { background: #d9d9d9; font-weight: 700; }
        .po-pnd-table .num { text-align: right; white-space: nowrap; }
        .po-pnd-party td { background: #eef2ff; font-weight: 600; }
        .po-pnd-total td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
        .po-pnd-grand td { font-weight: 700; background: #e2e8f0; }
      </style>
      <div class="po-pnd report-doc">
        <div class="po-pnd-header">
          <div class="po-pnd-company">${company}</div>
          <div class="po-pnd-title">${title}</div>
          <div class="po-pnd-period">${period}</div>
        </div>
        <table class="po-pnd-table">
          <thead>
            <tr>
              <th>Item Name</th><th>Date</th><th>So.No.</th><th>Loc</th><th>God</th><th>B.No.</th><th>B/K/H</th>
              <th class="num">OQTY.</th><th class="num">SQTY.</th><th class="num">BQTY.</th>
              <th class="num">OWgt.</th><th class="num">SWgt.</th><th class="num">BWgt.</th><th class="num">Rate</th><th>Broker</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="15">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr class="po-pnd-grand">
              <td colspan="7"><strong>TOTAL</strong></td>
              <td class="num">${formatAmtPdf(grand.so_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.sl_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.bqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.so_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.sl_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.bwgt, 3)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function buildSalesOrderPendingSummaryHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'PENDING SALES ORDER LIST');
  const period = escHtml(
    metadata.period || `FROM ${formatLedgerDateDisplay(payload?.s_date) || payload?.s_date || '—'} TO ${formatLedgerDateDisplay(payload?.e_date) || payload?.e_date || '—'}`
  );
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const grand = payload?.grand || {};

  const sumFields = (list, keys) => {
    const t = {};
    for (const k of keys) t[k] = 0;
    for (const r of list) for (const k of keys) t[k] += Number(r[k]) || 0;
    return t;
  };
  const qtyKeys = ['oqty', 'rqty', 'bqty', 'owgt', 'rwgt', 'bwgt'];

  let body = '';
  let currentCode = null;
  let currentItem = null;
  let itemRows = [];
  let partyRows = [];

  const itemTotalRow = (list, label) => {
    const t = sumFields(list, qtyKeys);
    return `<tr class="so-pnd-total"><td colspan="4"><strong>${label}</strong></td>
      <td class="num">${formatAmtPdf(t.oqty, 0)}</td><td class="num">${formatAmtPdf(t.rqty, 0)}</td><td class="num">${formatAmtPdf(t.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(t.owgt, 3)}</td><td class="num">${formatAmtPdf(t.rwgt, 3)}</td><td class="num">${formatAmtPdf(t.bwgt, 3)}</td><td></td></tr>`;
  };

  const flushItem = () => {
    if (itemRows.length) body += itemTotalRow(itemRows, 'ITEM TOTAL');
    itemRows = [];
  };
  const flushParty = () => {
    flushItem();
    if (partyRows.length) body += itemTotalRow(partyRows, 'PARTY TOTAL');
    partyRows = [];
  };

  for (const r of rows) {
    if (currentCode !== r.code) {
      flushParty();
      currentCode = r.code;
      currentItem = null;
      partyRows = [];
      body += `<tr class="so-pnd-party"><td colspan="11"><strong>${escHtml(r.name)}</strong>${r.bk_name ? ` &nbsp; Broker: ${escHtml(r.bk_name)}` : ''}</td></tr>`;
    }
    if (currentItem !== r.item_code) {
      flushItem();
      currentItem = r.item_code;
      itemRows = [];
    }
    itemRows.push(r);
    partyRows.push(r);
    body += `<tr>
      <td>${escHtml(r.item_name)}</td>
      <td>${escHtml(r.god_code)}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.so_date) || r.so_date)}</td>
      <td class="num">${escHtml(r.so_no)}</td>
      <td class="num">${formatAmtPdf(r.oqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.rqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.owgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.rwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.bwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.rate)}</td>
    </tr>`;
    if (r.remarks || r.delv_city) {
      body += `<tr class="so-pnd-sub"><td colspan="11">${r.remarks ? `Remarks: ${escHtml(r.remarks)}` : ''}${r.delv_city ? ` &nbsp; Delv.Station: ${escHtml(r.delv_city)}` : ''}</td></tr>`;
    }
  }
  flushParty();

  return `
    <div class="report-doc so-pnd">
      <style>
        ${PDF_REPORT_STYLES}
        .so-pnd.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; font-size: 8.5px; }
        .so-pnd-header { text-align: center; margin-bottom: 8px; }
        .so-pnd-company { font-size: 14px; font-weight: 700; text-transform: uppercase; }
        .so-pnd-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
        .so-pnd-period { font-size: 9px; margin-top: 3px; }
        .so-pnd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .so-pnd-table th, .so-pnd-table td { border: 1px solid #bbb; padding: 2px 3px; vertical-align: top; word-break: break-word; }
        .so-pnd-table thead th { background: #d9d9d9; font-weight: 700; }
        .so-pnd-table .num { text-align: right; white-space: nowrap; }
        .so-pnd-party td { background: #eef2ff; font-weight: 600; }
        .so-pnd-total td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
        .so-pnd-sub td { font-size: 8px; color: #444; border-top: none; }
        .so-pnd-grand td { font-weight: 700; background: #e2e8f0; }
      </style>
      <div class="so-pnd report-doc">
        <div class="so-pnd-header">
          <div class="so-pnd-company">${company}</div>
          <div class="so-pnd-title">${title}</div>
          <div class="so-pnd-period">${period}</div>
        </div>
        <table class="so-pnd-table">
          <thead>
            <tr>
              <th rowspan="2">Item Name</th><th rowspan="2">God.</th>
              <th rowspan="2">So.Date</th><th rowspan="2">So.No.</th>
              <th colspan="3">Qty.</th><th colspan="3">Weight</th><th rowspan="2">Rate</th>
            </tr>
            <tr>
              <th class="num">Oqty.</th><th class="num">SQty.</th><th class="num">BQty.</th>
              <th class="num">OWgt.</th><th class="num">SWgt.</th><th class="num">BWgt.</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="11">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr class="so-pnd-grand">
              <td colspan="4"><strong>TOTAL</strong></td>
              <td class="num">${formatAmtPdf(grand.oqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.rqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.bqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.owgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.rwgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.bwgt, 3)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function buildSalesOrderPendingDetailHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'PENDING SALES ORDER LIST');
  const period = escHtml(
    metadata.period || `FROM ${formatLedgerDateDisplay(payload?.s_date) || payload?.s_date || '—'} TO ${formatLedgerDateDisplay(payload?.e_date) || payload?.e_date || '—'}`
  );
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const grand = payload?.grand || {};
  const qtyKeys = ['so_qty', 'sl_qty', 'bqty', 'so_wgt', 'sl_wgt', 'bwgt'];

  const sumFields = (list, keys) => {
    const t = {};
    for (const k of keys) t[k] = 0;
    for (const r of list) for (const k of keys) t[k] += Number(r[k]) || 0;
    return t;
  };

  let body = '';
  let currentCode = null;
  let currentSo = null;
  let orderRows = [];
  let partyRows = [];

  const totalRow = (list, label, colspan = 6) => {
    const t = sumFields(list, qtyKeys);
    return `<tr class="so-pnd-total"><td colspan="${colspan}"><strong>${label}</strong></td>
      <td class="num">${formatAmtPdf(t.so_qty, 0)}</td><td class="num">${formatAmtPdf(t.sl_qty, 0)}</td><td class="num">${formatAmtPdf(t.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(t.so_wgt, 3)}</td><td class="num">${formatAmtPdf(t.sl_wgt, 3)}</td><td class="num">${formatAmtPdf(t.bwgt, 3)}</td><td></td><td></td></tr>`;
  };

  const flushOrder = () => {
    if (orderRows.length) body += totalRow(orderRows, `ORDER TOTAL — ${currentSo}`);
    orderRows = [];
  };
  const flushParty = () => {
    flushOrder();
    if (partyRows.length) body += totalRow(partyRows, 'PARTY TOTAL');
    partyRows = [];
  };

  for (const r of rows) {
    if (currentCode !== r.code) {
      flushParty();
      currentCode = r.code;
      currentSo = null;
      partyRows = [];
      body += `<tr class="so-pnd-party"><td colspan="14"><strong>${escHtml(r.name)}</strong></td></tr>`;
    }
    if (currentSo !== null && r.so_no !== currentSo) flushOrder();
    currentSo = r.so_no;
    orderRows.push(r);
    partyRows.push(r);
    const billNo = r.m_type === 1 ? '' : String(r.bill_no || '');
    body += `<tr>
      <td>${escHtml(r.item_name)}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.so_date) || r.so_date)}</td>
      <td class="num">${escHtml(r.so_no)}</td>
      <td>${escHtml(r.god_code)}</td>
      <td>${escHtml(billNo)}</td>
      <td>${escHtml(r.status)}</td>
      <td class="num">${formatAmtPdf(r.so_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.sl_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.so_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.sl_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.bwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.rate)}</td>
      <td>${escHtml(r.bk_name)}</td>
    </tr>`;
  }
  flushParty();

  return `
    <div class="report-doc so-pnd">
      <style>
        ${PDF_REPORT_STYLES}
        .so-pnd.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; font-size: 8px; }
        .so-pnd-header { text-align: center; margin-bottom: 8px; }
        .so-pnd-company { font-size: 14px; font-weight: 700; text-transform: uppercase; }
        .so-pnd-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
        .so-pnd-period { font-size: 9px; margin-top: 3px; }
        .so-pnd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .so-pnd-table th, .so-pnd-table td { border: 1px solid #bbb; padding: 2px 3px; vertical-align: top; word-break: break-word; }
        .so-pnd-table thead th { background: #d9d9d9; font-weight: 700; }
        .so-pnd-table .num { text-align: right; white-space: nowrap; }
        .so-pnd-party td { background: #eef2ff; font-weight: 600; }
        .so-pnd-total td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
        .so-pnd-grand td { font-weight: 700; background: #e2e8f0; }
      </style>
      <div class="so-pnd report-doc">
        <div class="so-pnd-header">
          <div class="so-pnd-company">${company}</div>
          <div class="so-pnd-title">${title}</div>
          <div class="so-pnd-period">${period}</div>
        </div>
        <table class="so-pnd-table">
          <thead>
            <tr>
              <th>Item Name</th><th>Date</th><th>So.No.</th><th>God</th><th>B.No.</th><th>B/K/H</th>
              <th class="num">OQTY.</th><th class="num">SQTY.</th><th class="num">BQTY.</th>
              <th class="num">OWgt.</th><th class="num">SWgt.</th><th class="num">BWgt.</th><th class="num">Rate</th><th>Broker</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="14">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr class="so-pnd-grand">
              <td colspan="6"><strong>TOTAL</strong></td>
              <td class="num">${formatAmtPdf(grand.so_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.sl_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.bqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.so_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.sl_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.bwgt, 3)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function buildSalesOrderPendingSoDoSaleHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'PENDING SALES ORDER LIST');
  const period = escHtml(
    metadata.period || `FROM ${formatLedgerDateDisplay(payload?.s_date) || payload?.s_date || '—'} TO ${formatLedgerDateDisplay(payload?.e_date) || payload?.e_date || '—'}`
  );
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const grand = payload?.grand || {};
  const qtyKeys = ['so_qty', 'do_qty', 'sl_qty', 'bqty', 'bqty_so_do', 'so_wgt', 'do_wgt', 'sl_wgt', 'bwgt', 'bwgt_so_do'];

  const sumFields = (list, keys) => {
    const t = {};
    for (const k of keys) t[k] = 0;
    for (const r of list) for (const k of keys) t[k] += Number(r[k]) || 0;
    return t;
  };

  let body = '';
  let currentCode = null;
  let currentSo = null;
  let orderRows = [];
  let partyRows = [];

  const totalRow = (list, label, colspan = 6) => {
    const t = sumFields(list, qtyKeys);
    return `<tr class="so-pnd-total"><td colspan="${colspan}"><strong>${label}</strong></td>
      <td class="num">${formatAmtPdf(t.so_qty, 0)}</td><td class="num">${formatAmtPdf(t.do_qty, 0)}</td><td class="num">${formatAmtPdf(t.sl_qty, 0)}</td><td class="num">${formatAmtPdf(t.bqty, 0)}</td><td class="num">${formatAmtPdf(t.bqty_so_do, 0)}</td>
      <td class="num">${formatAmtPdf(t.so_wgt, 3)}</td><td class="num">${formatAmtPdf(t.do_wgt, 3)}</td><td class="num">${formatAmtPdf(t.sl_wgt, 3)}</td><td class="num">${formatAmtPdf(t.bwgt, 3)}</td><td class="num">${formatAmtPdf(t.bwgt_so_do, 3)}</td><td></td><td></td></tr>`;
  };

  const flushOrder = () => {
    if (orderRows.length) body += totalRow(orderRows, `ORDER TOTAL — ${currentSo}`);
    orderRows = [];
  };
  const flushParty = () => {
    flushOrder();
    if (partyRows.length) body += totalRow(partyRows, 'PARTY TOTAL');
    partyRows = [];
  };

  for (const r of rows) {
    if (currentCode !== r.code) {
      flushParty();
      currentCode = r.code;
      currentSo = null;
      partyRows = [];
      body += `<tr class="so-pnd-party"><td colspan="19"><strong>${escHtml(r.name)}</strong></td></tr>`;
    }
    if (currentSo !== null && r.so_no !== currentSo) flushOrder();
    currentSo = r.so_no;
    orderRows.push(r);
    partyRows.push(r);
    const billNo = r.m_type === 1 ? '' : String(r.bill_no || '');
    body += `<tr>
      <td>${escHtml(r.item_name)}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.so_date) || r.so_date)}</td>
      <td class="num">${escHtml(r.so_no)}</td>
      <td>${escHtml(r.god_code)}</td>
      <td>${escHtml(billNo)}</td>
      <td>${escHtml(r.status)}</td>
      <td class="num">${formatAmtPdf(r.so_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.do_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.sl_qty, 0)}</td>
      <td class="num">${formatAmtPdf(r.bqty, 0)}</td>
      <td class="num">${formatAmtPdf(r.bqty_so_do, 0)}</td>
      <td class="num">${formatAmtPdf(r.so_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.do_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.sl_wgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.bwgt, 3)}</td>
      <td class="num">${formatAmtPdf(r.bwgt_so_do, 3)}</td>
      <td>${escHtml(r.valid_date || '')}</td>
      <td class="num">${formatAmtPdf(r.rate)}</td>
      <td>${escHtml(r.bk_name)}</td>
    </tr>`;
  }
  flushParty();

  return `
    <div class="report-doc so-pnd">
      <style>
        ${PDF_REPORT_STYLES}
        .so-pnd.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; font-size: 8px; }
        .so-pnd-header { text-align: center; margin-bottom: 8px; }
        .so-pnd-company { font-size: 14px; font-weight: 700; text-transform: uppercase; }
        .so-pnd-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
        .so-pnd-period { font-size: 9px; margin-top: 3px; }
        .so-pnd-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .so-pnd-table th, .so-pnd-table td { border: 1px solid #bbb; padding: 2px 3px; vertical-align: top; word-break: break-word; }
        .so-pnd-table thead th { background: #d9d9d9; font-weight: 700; }
        .so-pnd-table .num { text-align: right; white-space: nowrap; }
        .so-pnd-party td { background: #eef2ff; font-weight: 600; }
        .so-pnd-total td { font-weight: 700; background: #f8fafc; border-top: 2px solid #666; }
        .so-pnd-grand td { font-weight: 700; background: #e2e8f0; }
      </style>
      <div class="so-pnd report-doc">
        <div class="so-pnd-header">
          <div class="so-pnd-company">${company}</div>
          <div class="so-pnd-title">${title} (SO/DO/SALE)</div>
          <div class="so-pnd-period">${period}</div>
        </div>
        <table class="so-pnd-table">
          <thead>
            <tr>
              <th>Item Name</th><th>Date</th><th>So.No.</th><th>God</th><th>B.No.</th><th>B/K/H</th>
              <th class="num">SO Qty</th><th class="num">DO Qty</th><th class="num">SL Qty</th><th class="num">BQty So-Sl</th><th class="num">BQty So-Do</th>
              <th class="num">SO Wgt</th><th class="num">DO Wgt</th><th class="num">SL Wgt</th><th class="num">BWgt So-Sl</th><th class="num">BWgt So-Do</th><th>Valid Date</th><th class="num">Rate</th><th>Broker</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="19">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr class="so-pnd-grand">
              <td colspan="6"><strong>TOTAL</strong></td>
              <td class="num">${formatAmtPdf(grand.so_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.do_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.sl_qty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.bqty, 0)}</td>
              <td class="num">${formatAmtPdf(grand.bqty_so_do, 0)}</td>
              <td class="num">${formatAmtPdf(grand.so_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.do_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.sl_wgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.bwgt, 3)}</td>
              <td class="num">${formatAmtPdf(grand.bwgt_so_do, 3)}</td>
              <td></td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function buildPurchaseOrderChecklistHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'PURCHASE ORDER CHECKLIST');
  const period = escHtml(metadata.period || '—');
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const totals = payload?.totals || {};
  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r.so_date)}</td>
        <td class="amount">${escHtml(r.so_no)}</td>
        <td>${escHtml(r.delv_date)}</td>
        <td>${escHtml(r.party_name)}</td>
        <td>${escHtml(r.broker_supplier)}</td>
        <td>${escHtml(r.item_name)}</td>
        <td>${escHtml(r.loc_code)}</td>
        <td>${escHtml(r.god_code)}</td>
        <td class="amount">${formatAmtPdf(r.qnty, 0)}</td>
        <td class="amount">${formatAmtPdf(r.weight, 3)}</td>
        <td class="amount">${formatAmtPdf(r.rate)}</td>
        <td class="amount">${formatAmtPdf(r.amount)}</td>
        <td class="amount">${formatAmtPdf(r.dr_amt)}</td>
      </tr>`
    )
    .join('');
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .po-checklist.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; }
        .po-checklist .po-checklist-header { text-align: center; margin-bottom: 10px; }
        .po-checklist .po-checklist-company { font-size: 15px; font-weight: 700; text-transform: uppercase; }
        .po-checklist .po-checklist-title { font-size: 16px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .po-checklist .po-checklist-period { font-size: 10px; margin-top: 4px; color: #444; }
        .po-checklist .table-report { width: 100%; table-layout: fixed; font-size: 7.5px; border-collapse: collapse; }
        .po-checklist .table-report th, .po-checklist .table-report td { border: 1px solid #ddd; padding: 2px 3px; line-height: 1.1; vertical-align: top; word-break: break-word; }
        .po-checklist .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
        .po-checklist .table-report tfoot td { font-weight: 700; background: #f8fafc; border-top: 2px solid #777; }
      </style>
      <div class="po-checklist report-doc">
        <div class="po-checklist-header">
          <div class="po-checklist-company">${company}</div>
          <div class="po-checklist-title">${title}</div>
          <div class="po-checklist-period">${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Date</th>
              <th class="amount">No.</th>
              <th>Delv.Date</th>
              <th>Party Name</th>
              <th>Broker/Supplier</th>
              <th>Item Name</th>
              <th>Loc.</th>
              <th>God.</th>
              <th class="amount">Qty.</th>
              <th class="amount">Weight</th>
              <th class="amount">Rate</th>
              <th class="amount">Amount</th>
              <th class="amount">Adv.Amount</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="13">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr>
              <td colspan="8">GRAND TOTAL</td>
              <td class="amount">${formatAmtPdf(totals.qnty, 0)}</td>
              <td class="amount">${formatAmtPdf(totals.weight, 3)}</td>
              <td></td>
              <td class="amount">${formatAmtPdf(totals.amount)}</td>
              <td class="amount">${formatAmtPdf(totals.dr_amt)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

const GI_PRINT_STYLES = `
  .gi-print { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; }
  .gi-print-copy { page-break-after: always; }
  .gi-print-copy:last-child { page-break-after: auto; }
  .gi-print-top { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  .gi-print-top td { vertical-align: top; border: none; padding: 0 2px; font-size: 8.5px; line-height: 1.25; }
  .gi-print-top__title { text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
  .gi-print-top__side { width: 32%; }
  .gi-print-top__side--right { text-align: right; }
  .gi-print-company { text-align: center; margin: 2px 0 8px; line-height: 1.25; }
  .gi-print-slogan { font-size: 9px; font-weight: 600; }
  .gi-print-company__name { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .gi-print-company__tag { font-size: 10px; font-weight: 700; margin-top: 1px; }
  .gi-print-party-row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
  .gi-print-party { flex: 1; min-width: 0; line-height: 1.35; font-size: 9.5px; }
  .gi-print-meta { width: 190px; border-collapse: collapse; font-size: 9px; flex-shrink: 0; }
  .gi-print-meta td { border: 1px solid #999; padding: 2px 5px; }
  .gi-print-meta__head { background: #d9d9d9; }
  .gi-print-meta__label { font-weight: 600; width: 52%; }
  .gi-print-table { width: 100%; border-collapse: collapse; font-size: 8.5px; margin-top: 2px; table-layout: fixed; }
  .gi-print-table th, .gi-print-table td { border: 1px solid #999; padding: 2px 3px; vertical-align: top; word-break: break-word; }
  .gi-print-table thead th { background: #d9d9d9; font-weight: 700; }
  .gi-print-table tfoot td { border-top: 2px solid #666; }
  .gi-print-table .num { text-align: right; white-space: nowrap; }
  .gi-print-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; font-size: 9px; line-height: 1.35; }
`;

function buildSingleGoodsInwardPrintCopy(note, company, metadata) {
  const h = note?.header || {};
  const lines = Array.isArray(note?.lines) ? note.lines : [];
  const t = note?.totals || {};
  const compName = escHtml(company.companyName || metadata.companyName || '');
  const slogan = escHtml(company.billSlogan || '');
  const bHeader = escHtml(company.bHeader || '');
  const addr1 = escHtml(company.add1 || '');
  const addr2 = escHtml(company.add2 || '');
  const gst = escHtml(company.gst || h.gst_no || '');
  const email = escHtml(company.email || '');
  const tel1 = escHtml(company.tel1 || '');
  const tel2 = escHtml(company.tel2 || '');
  const tel3 = escHtml(company.tel3 || '');
  const phLine = [tel1, tel2].filter(Boolean).join(', ');
  const title = escHtml(h.head_name || metadata.documentTitle || 'GATE PASS/INWARD');
  const stateLine = [h.state_code, h.state].map((v) => String(v || '').trim()).filter(Boolean).join(' — ');

  let body = '';
  for (const ln of lines) {
    const unit = String(ln.status_unit || '').trim();
    body += `<tr>
      <td class="num">${escHtml(ln.po_no || '')}</td>
      <td>${escHtml(ln.item_name || '')}</td>
      <td>${escHtml(ln.bard_item_name || '')}</td>
      <td>${escHtml(unit)}</td>
      <td class="num">${formatAmtPdf(ln.qnty, 0)}</td>
      <td class="num">${formatAmtPdf(ln.packing, 0)}</td>
      <td class="num">${formatAmtPdf(ln.g_weight, 3)}</td>
      <td class="num">${formatAmtPdf(ln.d_weight, 3)}</td>
      <td class="num">${formatAmtPdf(ln.weight, 3)}</td>
      <td class="num">${formatAmtPdf(ln.rate)}</td>
      <td>${escHtml(ln.cost_code || '')}</td>
    </tr>`;
  }

  return `
    <div class="gi-print-copy">
      <table class="gi-print-top">
        <tr>
          <td class="gi-print-top__side">
            ${gst ? `<div>GSTIN: ${gst}</div>` : ''}
            ${email ? `<div>EMAIL: ${email}</div>` : ''}
          </td>
          <td class="gi-print-top__title">${title}</td>
          <td class="gi-print-top__side gi-print-top__side--right">
            ${phLine ? `<div>PH: ${phLine}</div>` : ''}
            ${tel3 ? `<div>FAX: ${tel3}</div>` : ''}
          </td>
        </tr>
      </table>
      <div class="gi-print-company">
        ${slogan ? `<div class="gi-print-slogan">${slogan}</div>` : ''}
        <div class="gi-print-company__name">${compName}</div>
        ${bHeader ? `<div class="gi-print-company__tag">${bHeader}</div>` : ''}
        ${addr1 ? `<div>${addr1}</div>` : ''}
        ${addr2 ? `<div>${addr2}</div>` : ''}
      </div>
      <div class="gi-print-party-row">
        <div class="gi-print-party">
          <div>M/s <strong>${escHtml(h.party_name || '')}</strong></div>
          <div>State: ${escHtml(stateLine || '—')}</div>
          <div>GSTin: ${escHtml(h.gst_no || '—')}</div>
          ${h.bk_name ? `<div>Broker: <strong>${escHtml(h.bk_name)}</strong></div>` : ''}
        </div>
        <table class="gi-print-meta">
          <tr class="gi-print-meta__head"><td class="gi-print-meta__label">No.</td><td>${escHtml(h.bill_no)}</td></tr>
          <tr class="gi-print-meta__head"><td class="gi-print-meta__label">Dated</td><td>${escHtml(toDisplayDate(h.bill_date) || h.bill_date)}</td></tr>
          <tr><td class="gi-print-meta__label">Truck No.</td><td>${escHtml(h.truck_no || '')}</td></tr>
          <tr><td class="gi-print-meta__label">Time In</td><td>${escHtml(h.time_in || '')}</td></tr>
          <tr><td class="gi-print-meta__label">Time Out</td><td>${escHtml(h.time_out || '')}</td></tr>
        </table>
      </div>
      <table class="gi-print-table">
        <thead>
          <tr>
            <th>Po.No.</th><th>Commodity</th><th>Bardana</th><th>Unit</th>
            <th class="num">Qty.</th><th class="num">Pkg.</th><th class="num">G.Weight</th>
            <th class="num">Dana</th><th class="num">Net Weight</th><th class="num">Rate</th><th>Cost</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td colspan="4"><strong>TOTAL</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.qnty, 0)}</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.packing, 0)}</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.g_weight, 3)}</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.d_weight, 3)}</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.weight, 3)}</strong></td>
            <td class="num"><strong>${formatAmtPdf(t.amount)}</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div class="gi-print-footer">
        <div>
          ${h.gr_no ? `<div>G.R.No.: ${escHtml(h.gr_no)}</div>` : ''}
          ${h.tpt ? `<div>Transport: ${escHtml(h.tpt)}</div>` : ''}
          ${h.remarks ? `<div>Remarks: ${escHtml(h.remarks)}</div>` : ''}
          ${h.dk_weight_net ? `<div>Net Wgt (Kanta): ${formatAmtPdf(h.dk_weight_net, 3)}</div>` : ''}
        </div>
        <div>For ${compName}</div>
      </div>
    </div>`;
}

function buildGoodsInwardPrintHtml(payload, metadata) {
  const company = metadata?.company || {};
  const notes = Array.isArray(payload?.notes) ? payload.notes : [];
  const copies = notes.map((note) => buildSingleGoodsInwardPrintCopy(note, company, metadata)).join('');
  return `
    <div class="gi-print report-doc">
      <style>${PDF_REPORT_STYLES}${GI_PRINT_STYLES}</style>
      ${copies || '<div class="voucher-help-modal__msg">No inward notes to print.</div>'}
    </div>`;
}

function buildGoodsInwardChecklistHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'INWARD REGISTER');
  const period = escHtml(metadata.period || '—');
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const totals = payload?.totals || {};
  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r.bill_date)}</td>
        <td class="amount">${escHtml(r.bill_no)}</td>
        <td class="amount">${escHtml(r.sb_no || '')}</td>
        <td>${escHtml(r.party_name)}</td>
        <td>${escHtml(r.bk_name)}</td>
        <td class="amount">${escHtml(r.po_no || '')}</td>
        <td>${escHtml(r.item_name)}</td>
        <td class="amount">${formatAmtPdf(r.qnty, 0)}</td>
        <td class="amount">${formatAmtPdf(r.weight, 3)}</td>
        <td class="amount">${formatAmtPdf(r.rate)}</td>
        <td class="amount">${formatAmtPdf(r.amount)}</td>
        <td>${escHtml(r.god_code)}</td>
      </tr>`
    )
    .join('');
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .gi-checklist.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; }
        .gi-checklist .gi-checklist-header { text-align: center; margin-bottom: 10px; }
        .gi-checklist .gi-checklist-company { font-size: 15px; font-weight: 700; text-transform: uppercase; }
        .gi-checklist .gi-checklist-title { font-size: 16px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .gi-checklist .gi-checklist-period { font-size: 10px; margin-top: 4px; color: #444; }
        .gi-checklist .table-report { width: 100%; table-layout: fixed; font-size: 7.5px; border-collapse: collapse; }
        .gi-checklist .table-report th, .gi-checklist .table-report td { border: 1px solid #ddd; padding: 2px 3px; line-height: 1.1; vertical-align: top; word-break: break-word; }
        .gi-checklist .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
        .gi-checklist .table-report tfoot td { font-weight: 700; background: #f8fafc; border-top: 2px solid #777; }
      </style>
      <div class="gi-checklist report-doc">
        <div class="gi-checklist-header">
          <div class="gi-checklist-company">${company}</div>
          <div class="gi-checklist-title">${title}</div>
          <div class="gi-checklist-period">${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Date</th>
              <th class="amount">No.</th>
              <th class="amount">SB</th>
              <th>Party Name</th>
              <th>Broker</th>
              <th class="amount">Po.No.</th>
              <th>Item Name</th>
              <th class="amount">Qty.</th>
              <th class="amount">Weight</th>
              <th class="amount">Rate</th>
              <th class="amount">Amount</th>
              <th>God.</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="12">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr>
              <td colspan="7">GRAND TOTAL</td>
              <td class="amount">${formatAmtPdf(totals.qnty, 0)}</td>
              <td class="amount">${formatAmtPdf(totals.weight, 3)}</td>
              <td></td>
              <td class="amount">${formatAmtPdf(totals.amount)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

function buildConsignmentStockChecklistHtml(payload, metadata = {}) {
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(payload?.head_name || metadata.reportTitle || 'CONSIGNMENT STOCK LIST');
  const period = escHtml(metadata.period || '—');
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const totals = payload?.totals || {};
  const body = rows
    .map(
      (r) => `<tr>
        <td>${escHtml(r.r_date)}</td>
        <td class="amount">${escHtml(r.r_no)}</td>
        <td>${escHtml(r.b_no_disp || r.b_no || '')}</td>
        <td class="amount">${escHtml(r.item_code)}</td>
        <td>${escHtml(r.item_name)}</td>
        <td>${escHtml(r.god_code)}</td>
        <td class="amount">${escHtml(r.lot || '')}</td>
        <td>${escHtml(r.party_name)}</td>
        <td class="amount">${formatAmtPdf(r.bags, 0)}</td>
        <td class="amount">${formatAmtPdf(r.katta, 0)}</td>
        <td class="amount">${formatAmtPdf(r.hkatta, 0)}</td>
        <td class="amount">${formatAmtPdf(r.weight, 3)}</td>
        <td class="amount">${formatAmtPdf(r.amount)}</td>
        <td>${escHtml(r.f_form)}</td>
        <td>${escHtml(r.labour)}</td>
        <td>${escHtml(r.l_c)}</td>
        <td>${escHtml(r.exp_cat)}</td>
        <td>${escHtml([r.truck_no, r.gr_no].filter(Boolean).join(' / '))}</td>
      </tr>`
    )
    .join('');
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .cstock-checklist.report-doc { border: 1px solid #c8c8c8; padding: 10px 12px; }
        .cstock-checklist .cstock-checklist-header { text-align: center; margin-bottom: 10px; }
        .cstock-checklist .cstock-checklist-company { font-size: 15px; font-weight: 700; text-transform: uppercase; }
        .cstock-checklist .cstock-checklist-title { font-size: 16px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .cstock-checklist .cstock-checklist-period { font-size: 10px; margin-top: 4px; color: #444; }
        .cstock-checklist .table-report { width: 100%; table-layout: fixed; font-size: 7px; border-collapse: collapse; }
        .cstock-checklist .table-report th, .cstock-checklist .table-report td { border: 1px solid #ddd; padding: 2px 2px; line-height: 1.1; vertical-align: top; word-break: break-word; }
        .cstock-checklist .table-report thead th { background: #f4f4f4; color: #111; text-align: left; }
        .cstock-checklist .table-report tfoot td { font-weight: 700; background: #f8fafc; border-top: 2px solid #777; }
      </style>
      <div class="cstock-checklist report-doc">
        <div class="cstock-checklist-header">
          <div class="cstock-checklist-company">${company}</div>
          <div class="cstock-checklist-title">${title}</div>
          <div class="cstock-checklist-period">${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Date</th>
              <th class="amount">Sr.No.</th>
              <th>B.No.</th>
              <th class="amount">Item</th>
              <th>Item Name</th>
              <th>G</th>
              <th class="amount">Lot</th>
              <th>Party Name</th>
              <th class="amount">Bags</th>
              <th class="amount">Kata</th>
              <th class="amount">Hkatta</th>
              <th class="amount">Weight</th>
              <th class="amount">Amount</th>
              <th>Form</th>
              <th>FB</th>
              <th>L</th>
              <th>CAT</th>
              <th>Truck / GR</th>
            </tr>
          </thead>
          <tbody>${body || '<tr><td colspan="18">(No rows)</td></tr>'}</tbody>
          <tfoot>
            <tr>
              <td colspan="8">GRAND TOTAL</td>
              <td class="amount">${formatAmtPdf(totals.bags, 0)}</td>
              <td class="amount">${formatAmtPdf(totals.katta, 0)}</td>
              <td class="amount">${formatAmtPdf(totals.hkatta, 0)}</td>
              <td class="amount">${formatAmtPdf(totals.weight, 3)}</td>
              <td class="amount">${formatAmtPdf(totals.amount)}</td>
              <td colspan="5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

export function buildReportHtml(reportType, data, metadata) {
  if (reportType === 'voucher-print') return buildVoucherPrintHtml(data, metadata);
  if (reportType === 'purchase-order-print') return buildPurchaseOrderPrintHtml(data, metadata);
  if (reportType === 'purchase-order-checklist') return buildPurchaseOrderChecklistHtml(data, metadata);
  if (reportType === 'goods-inward-print') return buildGoodsInwardPrintHtml(data, metadata);
  if (reportType === 'goods-inward-checklist') return buildGoodsInwardChecklistHtml(data, metadata);
  if (reportType === 'consignment-stock-checklist') return buildConsignmentStockChecklistHtml(data, metadata);
  if (reportType === 'purchase-order-pending-summary') return buildPurchaseOrderPendingSummaryHtml(data, metadata);
  if (reportType === 'purchase-order-pending-detail') return buildPurchaseOrderPendingDetailHtml(data, metadata);
  if (reportType === 'sales-order-pending-summary') return buildSalesOrderPendingSummaryHtml(data, metadata);
  if (reportType === 'sales-order-pending-detail') return buildSalesOrderPendingDetailHtml(data, metadata);
  if (reportType === 'sales-order-pending-so-do-sale') return buildSalesOrderPendingSoDoSaleHtml(data, metadata);
  if (reportType === 'ledger') return buildLedgerReportHtml(data, metadata);
  if (reportType === 'complete-ledger') return buildCompleteLedgerReportHtml(data, metadata);
  if (reportType === 'trading-ledger') return buildTradingLedgerReportHtml(data, metadata);
  if (reportType === 'bill-ledger') return buildBillLedgerReportHtml(data, metadata);
  if (reportType === 'broker-os') return buildBrokerOsReportHtml(data, metadata);
  if (reportType === 'ageing') return buildAgeingReportHtml(data, metadata);
  if (reportType === 'sale-list') return buildSaleListReportHtml(data, metadata);
  if (reportType === 'sale-bill') return buildSaleBillReportHtml(data, metadata);
  if (reportType === 'stock-sum') return buildStockSumReportHtml(data, metadata);
  if (reportType === 'stock-sum-detail') return buildStockSumDetailReportHtml(data, metadata);
  if (reportType === 'stock-lot') return buildStockLotReportHtml(data, metadata);
  if (reportType === 'purchase-list') return buildPurchaseListReportHtml(data, metadata);
  if (reportType === 'purchase-bill') return buildPurchaseBillReportHtml(data, metadata);
  if (reportType === 'gstr1') return buildGstr1ReportHtml(data, metadata);
  if (reportType === 'hsn-sales') return buildHsnSalesReportHtml(data, metadata);
  if (reportType === 'hsn-purchase') return buildHsnSalesReportHtml(data, metadata);
  if (reportType === 'state-wise-sales' || reportType === 'state-wise-purchase') return buildStateWiseSalesReportHtml(data, metadata);
  if (reportType === 'balance-sheet') return buildBalanceSheetReportHtml(data, metadata);
  if (reportType === 'trading-account') return buildTradingAccountReportHtml(data, metadata);
  if (reportType === 'profit-loss') return buildProfitLossReportHtml(data, metadata);
  if (reportType === 'account-master') return buildAccountMasterReportHtml(data, metadata);
  if (reportType === 'item-master') return buildItemMasterReportHtml(data, metadata);
  if (reportType === 'schedule-master') return buildScheduleMasterReportHtml(data, metadata);
  if (reportType === 'cat-mast') return buildCatMastReportHtml(data, metadata);
  if (reportType === 'cost-mast') return buildCostMastReportHtml(data, metadata);
  if (reportType === 'item-grp') return buildItemGrpReportHtml(data, metadata);
  if (reportType === 'marka-master') return buildMarkaMasterReportHtml(data, metadata);
  if (reportType === 'pur-exp-master') return buildPurExpMasterReportHtml(data, metadata);
  if (reportType === 'sale-cond-master') return buildSaleCondMasterReportHtml(data, metadata);
  if (reportType === 'loc-btype-master') return buildLocBtypeMasterReportHtml(data, metadata);
  if (reportType === 'detail-mast-master') return buildDetailMastMasterReportHtml(data, metadata);
  if (reportType === 'opdet-report') return buildOpdetReportHtml(data, metadata);
  if (reportType === 'gst-state-master') return buildGstStateMasterReportHtml(data, metadata);
  if (reportType === 'loaner-list') return buildLoanerListReportHtml(data, metadata);
  if (
    reportType === 'purchase-tds-detail' ||
    reportType === 'purchase-tds-summary' ||
    reportType === 'sale-tds-detail' ||
    reportType === 'sale-tds-summary'
  ) {
    return buildPurchaseTdsReportHtml(data, metadata);
  }
  if (reportType === 'other-report' && metadata.reportId === 'labour-report') return buildLabourReportHtml(data, metadata);
  if (reportType === 'income-tax-report' || reportType === 'other-report' || reportType === 'ledger-report' || reportType === 'voucher-book') return buildIncomeTaxReportHtml(data, metadata);
  if (reportType === 'godown-master') return buildGodownMasterReportHtml(data, metadata);
  if (reportType === 'trial-balance') return buildTrialBalanceReportHtml(data, metadata);
  if (reportType === 'trial-balance-summary') return buildTrialBalanceSummaryReportHtml(data, metadata);
  if (reportType === 'trial-date-wise') return buildTrialDateWiseReportHtml(data, metadata);
  return buildTrialBalanceReportHtml(data, metadata);
}

function getPdfOptions(metadata, reportType) {
  const stamp = new Date().toISOString().split('T')[0];
  const inv = safeFilenamePart(metadata.invoiceNo || metadata.saleInvNo || '');
  const pbKey = safeFilenamePart(metadata.purchaseBillKey || '');
  const filename =
    reportType === 'sale-bill'
      ? `${safeFilenamePart(metadata.companyName)}_SaleBill_${inv || 'inv'}_${stamp}.pdf`
        : reportType === 'purchase-bill'
        ? `${safeFilenamePart(metadata.companyName)}_PurchaseBill_${pbKey || 'bill'}_${stamp}.pdf`
        : reportType === 'voucher-print' || reportType === 'purchase-order-print' || reportType === 'goods-inward-print'
          ? `${safeFilenamePart(metadata.companyName)}_${safeFilenamePart(metadata.documentTitle || 'Doc')}_${metadata.soNo || metadata.billNo || metadata.vrNo || metadata.receiptNo || 'doc'}_${stamp}.pdf`
        : reportType === 'purchase-order-checklist'
          ? `${safeFilenamePart(metadata.companyName)}_POChecklist_${stamp}.pdf`
        : reportType === 'goods-inward-checklist'
          ? `${safeFilenamePart(metadata.companyName)}_InwardChecklist_${stamp}.pdf`
        : reportType === 'consignment-stock-checklist'
          ? `${safeFilenamePart(metadata.companyName)}_CstockChecklist_${stamp}.pdf`
        : reportType === 'purchase-order-pending-summary'
          ? `${safeFilenamePart(metadata.companyName)}_POPendingSum_${stamp}.pdf`
        : reportType === 'purchase-order-pending-detail'
          ? `${safeFilenamePart(metadata.companyName)}_POPendingDet_${stamp}.pdf`
        : reportType === 'sales-order-pending-summary'
          ? `${safeFilenamePart(metadata.companyName)}_SOPendingSum_${stamp}.pdf`
        : reportType === 'sales-order-pending-detail'
          ? `${safeFilenamePart(metadata.companyName)}_SOPendingDet_${stamp}.pdf`
        : reportType === 'sales-order-pending-so-do-sale'
          ? `${safeFilenamePart(metadata.companyName)}_SOPendingSoDoSale_${stamp}.pdf`
        : reportType === 'stock-sum-detail'
          ? `${safeFilenamePart(metadata.companyName)}_StockDetail_${safeFilenamePart(metadata.itemCode || 'item')}_${stamp}.pdf`
          : `${safeFilenamePart(metadata.companyName)}_${reportType}_${stamp}.pdf`;
  const html2canvas =
    reportType === 'purchase-list'
      ? {
          scale: 1.75,
          useCORS: true,
          logging: false,
          windowWidth: 2000,
          scrollX: 0,
          scrollY: 0,
        }
      : reportType === 'hsn-sales'
        ? {
            scale: 1,
            useCORS: true,
            logging: false,
            windowWidth: 1800,
            scrollX: 0,
            scrollY: 0,
          }
        : reportType === 'state-wise-sales' || reportType === 'state-wise-purchase'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: 1800,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'voucher-print' || reportType === 'purchase-order-print' || reportType === 'goods-inward-print'
          ? {
              scale: 2,
              useCORS: true,
              logging: false,
              windowWidth: 794,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'purchase-order-checklist' || reportType === 'goods-inward-checklist' || reportType === 'consignment-stock-checklist'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: 2400,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'purchase-order-pending-summary' ||
            reportType === 'purchase-order-pending-detail' ||
            reportType === 'sales-order-pending-summary' ||
            reportType === 'sales-order-pending-detail' ||
            reportType === 'sales-order-pending-so-do-sale'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: 2600,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'godown-master'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: 3600,
              scrollX: 0,
              scrollY: 0,
            }
          : reportType === 'account-master' ||
              reportType === 'item-master' ||
              reportType === 'schedule-master' ||
              reportType === 'cat-mast' ||
              reportType === 'cost-mast' ||
              reportType === 'item-grp' ||
              reportType === 'marka-master' ||
              reportType === 'pur-exp-master' ||
              reportType === 'sale-cond-master' ||
              reportType === 'loc-btype-master' ||
              reportType === 'detail-mast-master' ||
              reportType === 'opdet-report' ||
              reportType === 'gst-state-master' ||
              reportType === 'loaner-list' ||
              reportType === 'purchase-tds-detail' ||
              reportType === 'purchase-tds-summary' ||
              reportType === 'sale-tds-detail' ||
              reportType === 'sale-tds-summary' ||
              reportType === 'income-tax-report' ||
              reportType === 'other-report' ||
              reportType === 'ledger-report' ||
              reportType === 'voucher-book'
            ? {
                scale: 1,
                useCORS: true,
                logging: false,
                windowWidth:
                  metadata?.reportId === 'brokerage-item-wise'
                    ? 3400
                    : reportType === 'income-tax-report' && metadata?.pdfLandscape === false
                      ? 794
                      : 2800,
                scrollX: 0,
                scrollY: 0,
              }
        : reportType === 'complete-ledger'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: 794,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'balance-sheet'
          ? {
              scale: 1.35,
              useCORS: true,
              logging: false,
              windowWidth: 2200,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'trial-balance-summary' ||
            reportType === 'trial-date-wise'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: reportType === 'trial-date-wise' ? 1400 : 1200,
              scrollX: 0,
              scrollY: 0,
            }
      : { scale: 2, useCORS: true };

  const pagebreak =
    reportType === 'complete-ledger'
      ? { mode: ['css', 'legacy'], before: '.complete-ledger-pdf-section--break' }
      : { mode: ['css', 'legacy'] };

  return {
    margin:
      reportType === 'sale-bill' || reportType === 'purchase-bill'
        ? 8
        : reportType === 'balance-sheet' || reportType === 'complete-ledger' || reportType === 'voucher-print' || reportType === 'purchase-order-print' || reportType === 'goods-inward-print'
          ? 6
          : 10,
    filename,
    image: { type: 'jpeg', quality: reportType === 'complete-ledger' ? 0.92 : 0.98 },
    html2canvas,
    pagebreak,
    jsPDF: {
      orientation:
        reportType === 'complete-ledger' ||
        reportType === 'ledger' ||
        reportType === 'sale-bill' ||
          reportType === 'purchase-bill' ||
          reportType === 'account-master' ||
          reportType === 'item-master' ||
          reportType === 'schedule-master' ||
          reportType === 'cat-mast' ||
          reportType === 'cost-mast' ||
          reportType === 'item-grp' ||
          reportType === 'marka-master' ||
          reportType === 'pur-exp-master' ||
          reportType === 'sale-cond-master' ||
          reportType === 'loc-btype-master' ||
          reportType === 'detail-mast-master' ||
          reportType === 'gst-state-master' ||
          reportType === 'voucher-print' || reportType === 'purchase-order-print' || reportType === 'goods-inward-print'
          ? 'portrait'
          : reportType === 'purchase-order-checklist' || reportType === 'goods-inward-checklist' || reportType === 'consignment-stock-checklist'
            ? 'landscape'
          : reportType === 'loaner-list' || reportType === 'income-tax-report' || reportType === 'other-report' || reportType === 'ledger-report' || reportType === 'voucher-book'
            ? metadata?.pdfLandscape === false
              ? 'portrait'
              : 'landscape'
          : reportType === 'opdet-report'
            ? 'landscape'
          : 'landscape',
      unit: 'mm',
      format: 'a4',
    },
  };
}

/** Combine pre-built report HTML fragments into one PDF (e.g. multiple sale bills). */
export async function getCombinedReportPdfBlob(reportType, htmlFragments, metadata = {}) {
  const fragments = (htmlFragments || []).filter(Boolean);
  if (!fragments.length) throw new Error('No report content to export.');
  const options = getPdfOptions(metadata, reportType);
  if (metadata.combinedFilename) options.filename = metadata.combinedFilename;
  const onProgress = metadata.onProgress;

  if (fragments.length === 1) {
    const blob = await html2pdf().set(options).from(fragments[0]).outputPdf('blob');
    return { blob, filename: options.filename };
  }

  const partBlobs = [];
  for (let i = 0; i < fragments.length; i++) {
    onProgress?.(i + 1, fragments.length);
    await yieldToMain();
    const blob = await html2pdf().set(options).from(fragments[i]).outputPdf('blob');
    partBlobs.push(blob);
  }
  onProgress?.(fragments.length, fragments.length);
  const blob = await mergePdfBlobs(partBlobs);
  return { blob, filename: options.filename };
}

export async function downloadCombinedReportPdf(reportType, htmlFragments, metadata = {}) {
  const { blob, filename } = await getCombinedReportPdfBlob(reportType, htmlFragments, metadata);
  downloadBlob(blob, filename);
}

/**
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function getPdfBlob(reportType, data, metadata) {
  const options = getPdfOptions(metadata, reportType);

  if (reportType === 'complete-ledger') {
    return getCompleteLedgerPdfBlob(data, metadata);
  }

  if (reportType === 'ledger') {
    try {
      const blob = buildLedgerJsPdfBlob(data, metadata);
      assertLedgerPdfBlob(blob);
      return { blob, filename: options.filename };
    } catch (err) {
      console.warn('Ledger jsPDF failed, falling back to html2pdf:', err);
    }
  }

  const htmlContent = buildReportHtml(reportType, data, metadata);
  const blob =
    reportType === 'voucher-print' || reportType === 'purchase-order-print' || reportType === 'goods-inward-print'
      ? await html2pdfFromHtmlDom(htmlContent, options)
      : await html2pdf().set(options).from(htmlContent).outputPdf('blob');
  if (!blob || blob.size < 80) {
    throw new Error('PDF could not be generated (empty output).');
  }
  return { blob, filename: options.filename };
}

/** Mount HTML off-screen so html2canvas can measure voucher/receipt layout reliably. */
async function html2pdfFromHtmlDom(htmlContent, options) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:210mm;visibility:hidden;pointer-events:none;';
  host.innerHTML = htmlContent;
  document.body.appendChild(host);
  try {
    const target = host.querySelector('.vou-print') || host.querySelector('.po-print') || host.querySelector('.gi-print') || host.firstElementChild || host;
    return await html2pdf().set(options).from(target).outputPdf('blob');
  } finally {
    document.body.removeChild(host);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openBlobInNewTab(blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) return;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Open print dialog for a PDF blob (iframe — works when blob tabs skip `load`). */
export function printPdfBlob(blob) {
  if (!blob || blob.size < 80) {
    return Promise.reject(new Error('PDF could not be generated (empty file).'));
  }
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', 'Print preview');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      URL.revokeObjectURL(url);
      iframe.remove();
    }, 120_000);
  };

  return new Promise((resolve) => {
    let printed = false;
    const tryPrint = () => {
      if (printed) return true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        printed = true;
        cleanup();
        resolve();
        return true;
      } catch (_) {
        return false;
      }
    };

    iframe.onload = () => {
      if (!tryPrint()) {
        openBlobInNewTab(blob);
        cleanup();
        resolve();
      }
    };

    setTimeout(() => {
      if (printed) return;
      if (tryPrint()) return;
      openBlobInNewTab(blob);
      cleanup();
      resolve();
    }, 2000);
  });
}

/**
 * Digits-only number for https://wa.me/… (no +). If `raw` is a 10-digit Indian mobile (6–9),
 * prefixes `countryCode` (default 91). Override with metadata.shareWhatsAppCountryCode.
 */
function normalizeWhatsAppPhoneDigits(raw, countryCode = '91') {
  if (raw == null || raw === '') return '';
  let d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  const cc = String(countryCode || '91').replace(/\D/g, '') || '91';
  if (d.length >= 11 && d.startsWith(cc)) return d;
  if (d.length === 10 && /^[6-9]/.test(d)) return cc + d;
  if (d.length >= 10) return d;
  return '';
}

function pickWhatsAppDigitsFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  const cc = metadata.shareWhatsAppCountryCode ?? '91';
  const explicit = normalizeWhatsAppPhoneDigits(
    metadata.shareWhatsAppPhone ?? metadata.whatsappPhone ?? '',
    cc
  );
  if (explicit.length >= 10) return explicit;
  for (const key of ['partyTel', 'accountTel', 'customerTel', 'dispatchTel']) {
    const n = normalizeWhatsAppPhoneDigits(metadata[key], cc);
    if (n.length >= 10) return n;
  }
  return '';
}

/** wa.me URLs have practical length limits; shrink message if needed. */
function buildWhatsAppWebUrl(phoneDigits, messageBody, maxUrlLength = 2000) {
  const base = phoneDigits ? `https://wa.me/${phoneDigits}?text=` : 'https://wa.me/?text=';
  let msg = String(messageBody ?? '');
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = base + encodeURIComponent(msg);
    if (url.length <= maxUrlLength) return url;
    msg =
      msg.slice(0, Math.max(180, Math.floor(msg.length * 0.72))) +
      '\n… (see PDF in Downloads — attach with paperclip.)';
  }
  return base + encodeURIComponent(String(messageBody ?? '').slice(0, 160));
}

function shouldPreferNativeFileShare() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const mobileUa = /android|iphone|ipad|ipod|windows phone|mobile/i.test(ua);
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const likelyMobile = mobileUa || touchPoints > 1;
  return likelyMobile;
}

/** Convert PDF blob → base64 for /api/invoices/upload. */
async function blobToPdfBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Publish PDF under public/invoices/<comp>/file.pdf and return public HTTPS URL for WhatsApp.
 * Falls back to '' if API/tunnel is unavailable (caller keeps attach-from-Downloads behaviour).
 */
async function publishInvoiceForWhatsApp(blob, filename, metadata = {}, apiBase = '') {
  try {
    const folder = String(
      metadata.invoiceFolder ??
        metadata.comp_code ??
        metadata.compCode ??
        metadata.COMP_CODE ??
        '1',
    )
      .trim() || '1';
    const pdfBase64 = await blobToPdfBase64(blob);
    const { data } = await axios.post(
      apiUrl(apiBase, '/api/invoices/upload'),
      { folder, filename, pdfBase64 },
      { timeout: 120000, withCredentials: true },
    );
    if (data?.ok && data?.publicUrl) return String(data.publicUrl);
    if (data?.ok && data?.path) {
      const origin = getPublicWebOrigin();
      return origin ? `${origin}${data.path}` : String(data.path);
    }
  } catch (err) {
    console.warn('Invoice publish for WhatsApp failed:', err?.response?.data || err?.message || err);
  }
  return '';
}

/** Download PDF (browser save dialog). */
export const generatePDF = async (reportType, data, metadata) => {
  const { blob, filename } = await getPdfBlob(reportType, data, metadata);
  if (metadata?.autoOpen) openBlobInNewTab(blob);
  downloadBlob(blob, filename);
};

/**
 * WhatsApp + PDF:
 * 1) Uploads PDF to server public/invoices/<comp>/… and puts a public HTTPS download link in the chat text
 *    (same pattern as VFP → Cloudflare → /invoices/…).
 * 2) On mobile with Web Share, also offers the PDF file as an attachment when possible.
 * 3) If upload fails: downloads PDF locally and opens wa.me with attach-from-Downloads hint.
 */
export async function sharePdfWithWhatsApp(reportType, data, metadata, shareText, options = {}) {
  let blob;
  let filename;
  if (options.prebuiltBlob && options.prebuiltFilename) {
    blob = options.prebuiltBlob;
    filename = options.prebuiltFilename;
  } else {
    ({ blob, filename } = await getPdfBlob(reportType, data, metadata));
  }
  const file = new File([blob], filename, { type: 'application/pdf', lastModified: Date.now() });
  const reportLabel =
    reportType === 'trial-balance'
      ? 'Trial Balance'
      : reportType === 'trial-balance-summary'
        ? 'Trial Balance Summary'
        : reportType === 'trial-date-wise'
          ? 'Trial Balance Date Wise'
      : reportType === 'trading-account'
        ? 'Trading A/C'
        : reportType === 'profit-loss'
          ? 'Profit & Loss Account'
          : reportType === 'balance-sheet'
            ? 'Balance Sheet'
      : reportType === 'bill-ledger'
        ? metadata?.billLedgerTitle || 'CustomerLedger'
        : reportType === 'broker-os'
          ? 'Broker outstanding'
          : reportType === 'account-master'
            ? 'A/c Master List'
            : reportType === 'item-master'
              ? 'Item Master List'
              : reportType === 'schedule-master'
                ? 'Schedule Master'
                : reportType === 'cat-mast'
                  ? 'Item Category Master'
                  : reportType === 'cost-mast'
                    ? 'Cost Centre Master'
                  : reportType === 'item-grp'
                    ? 'Item Group Master'
                    : reportType === 'marka-master'
                      ? 'Marka Master'
                    : reportType === 'pur-exp-master'
                      ? 'Purchase Exp Master'
                    : reportType === 'sale-cond-master'
                      ? 'Sale Bill Condition'
                    : reportType === 'loc-btype-master'
                      ? 'Location Wise BType'
                    : reportType === 'detail-mast-master'
                      ? 'Detail Master'
                    : reportType === 'gst-state-master'
                      ? 'GST State Master'
                    : reportType === 'loaner-list'
                      ? 'Loaner List'
                    : reportType === 'purchase-tds-detail'
                      ? 'Party Wise Purchase Detail (TDS)'
                    : reportType === 'purchase-tds-summary'
                      ? 'Party Wise Purchase Summary (TDS)'
                    : reportType === 'sale-tds-detail'
                      ? 'Party Wise Sale Detail (TDS)'
                    : reportType === 'sale-tds-summary'
                      ? 'Party Wise Sale Summary (TDS)'
                    : reportType === 'godown-master'
                      ? 'Godown Master'
          : reportType === 'voucher-print'
            ? metadata?.documentTitle || 'Voucher'
          : reportType === 'sale-list'
            ? 'Sale list'
            : reportType === 'sale-bill'
              ? 'Sale bill'
              : reportType === 'purchase-bill'
                ? 'Purchase bill'
                : reportType === 'stock-sum'
                  ? 'Stock sum'
                  : reportType === 'stock-sum-detail'
                    ? 'Stock detail'
                    : reportType === 'stock-lot'
                      ? 'Stock lot'
                      : reportType === 'purchase-list'
                        ? 'Purchase list'
                        : reportType === 'gstr1'
                          ? 'GSTR-1'
                          : reportType === 'hsn-sales'
                            ? 'HSN Sales'
                            : reportType === 'state-wise-sales'
                              ? 'State Wise Sales'
                              : reportType === 'state-wise-purchase'
                                ? 'State Wise Purchase'
                              : reportType === 'complete-ledger'
                                ? 'Complete Ledger'
                        : 'Ledger';
  const text =
    shareText || `${metadata.companyName}\n${reportLabel}\n${metadata.endDate || ''}`;

  const waDigits = pickWhatsAppDigitsFromMetadata(metadata);
  const hasTargetPhone = waDigits.length >= 10;
  const phoneHint = hasTargetPhone
    ? `Send to +${waDigits}\nOpen chat: https://wa.me/${waDigits}\n\n`
    : '';

  const publicUrl = await publishInvoiceForWhatsApp(blob, filename, metadata || {}, options.apiBase || '');
  const linkBlock = publicUrl
    ? `\n\nDownload PDF:\n${publicUrl}`
    : `\n\nPDF saved as: ${filename}\nIn WhatsApp, tap Attach (paperclip) and select this file from your Downloads folder.`;
  const body = text + linkBlock;

  let canShareFiles = false;
  try {
    canShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
  } catch {
    canShareFiles = false;
  }

  // Prefer link-based WhatsApp (works for any recipient phone; matches VFP).
  // Still offer native file share on mobile when no public URL was published.
  if (canShareFiles && !publicUrl) {
    try {
      await navigator.share({
        files: [file],
        title: text.split('\n')[0],
        text: phoneHint + text,
      });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  if (!publicUrl) {
    downloadBlob(blob, filename);
  }
  const url = buildWhatsAppWebUrl(hasTargetPhone ? waDigits : '', body);
  await new Promise((r) => setTimeout(r, 200));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
