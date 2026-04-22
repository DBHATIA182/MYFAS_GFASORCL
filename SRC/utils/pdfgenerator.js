import html2pdf from 'html2pdf.js';
import { formatLedgerDateDisplay } from './dateFormat';
import { buildBrokerOsDisplayRows } from './brokerOsDisplay';
import { buildSaleListDisplayRows, saleListMeas } from './saleListDisplay';
import { rupeesToWords } from './rupeesInWords';
import { rowFieldCI, rowFieldAny } from './rowFieldCI';
import { ageingCurBalDisplay } from './ageingDisplay';

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

function formatAmtPdf(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        }
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
        /* Ledger statement: narrow amount columns, more room for detail */
        table.table-report.table-report-ledger { table-layout: fixed; }
        table.table-report.table-report-ledger thead th {
          text-transform: none;
          letter-spacing: 0.02em;
        }
        table.table-report.table-report-ledger .col-detail {
          max-width: 90px;
          word-wrap: break-word;
          overflow-wrap: break-word;
          font-size: 6.6px;
        }
        table.table-report.table-report-ledger th.col-ledger-value-dt,
        table.table-report.table-report-ledger td.col-ledger-value-dt {
          width: 8%;
          max-width: 72px;
          white-space: nowrap;
          font-size: 7.5px;
        }
        table.table-report.table-report-ledger th.ledger-amt-col,
        table.table-report.table-report-ledger td.ledger-amt-col {
          width: 9%;
          max-width: 76px;
          font-size: 7.5px;
          padding: 3px 3px;
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
          font-size: 9px;
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
          font-size: 8px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #475569;
          margin-bottom: 4px;
          font-weight: 700;
        }
        .ledger-pdf-company-name {
          font-size: 11px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .ledger-pdf-line { margin: 2px 0; line-height: 1.35; }
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

/** Ledger PDF */
function buildLedgerReportHtml(data, metadata) {
  const rows = data || [];
  let sumDr = 0;
  let sumCr = 0;
  rows.forEach((row) => {
    sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
    sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
  });
  const last = rows[rows.length - 1];
  const closingBal =
    last != null
      ? parseFloat(last.CL_BALANCE ?? last.cl_balance ?? last.RUN_BAL ?? last.run_bal ?? 0) || 0
      : 0;

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const accName = escHtml(metadata.accountName);
  const accCode = escHtml(metadata.accountCode);
  const period = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const cAdd1 = escHtml(String(metadata.companyAdd1 ?? '').trim());
  const cAdd2 = escHtml(String(metadata.companyAdd2 ?? '').trim());
  const cGst = escHtml(String(metadata.companyGst ?? '').trim());
  const aAdd1 = escHtml(String(metadata.accountAdd1 ?? '').trim());
  const aAdd2 = escHtml(String(metadata.accountAdd2 ?? '').trim());
  const aCity = escHtml(String(metadata.accountCity ?? '').trim());
  const aGst = escHtml(String(metadata.accountGst ?? '').trim());
  const aPan = escHtml(String(metadata.accountPan ?? '').trim());
  const aTel = escHtml(String(metadata.accountTel ?? '').trim());

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
  const accountBlock = `<div class="ledger-pdf-account-block"><div class="ledger-pdf-block-title">Account</div>${accountLines}</div>`;

  let bodyRows = '';
  rows.forEach((row) => {
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
              <td class="col-date">${d}</td>
              <td class="col-date col-ledger-value-dt">${vd}</td>
              <td class="col-vr">${escHtml(row.VR_NO ?? row.vr_no ?? '—')}</td>
              <td class="col-type">${escHtml(vrType)}</td>
              <td class="col-type">${escHtml(lineType !== '' ? String(lineType) : '—')}</td>
              <td class="col-detail">${detail}</td>
              <td class="amount ledger-amt-col">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount ledger-amt-col">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount ledger-amt-col ${clCls}">${formatAmtPdf(clBal)}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>LEDGER ACCOUNT STATEMENT</h1>
        ${companyBlock}
        ${accountBlock}
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Account code</td><td class="val">${accCode}</td></tr>
        </table>
        <div class="report-period"><strong>Period: ${period}</strong> &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report table-report-ledger">
        <thead>
          <tr>
            <th>Vr.Date</th>
            <th class="col-ledger-value-dt">Value Date</th>
            <th>Vr.No.</th>
            <th>Vr.Type</th>
            <th>Type</th>
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
        <br />
        Computer-generated statement — no signature required.
      </div>
    </div>
  `;
}

/** Bill-wise ledger PDF (BILLS, running balance per bill); optional GETINT columns */
function buildBillLedgerReportHtml(data, metadata) {
  const rows = data || [];
  const useInt = Boolean(metadata.billLedgerInterest);
  const ledgerTitle = escHtml(metadata.billLedgerTitle || 'CustomerLedger');
  const ledgerKind = String(metadata.billLedgerKind || 'customer').toLowerCase() === 'supplier' ? 'supplier' : 'customer';
  let sumDr = 0;
  let sumCr = 0;
  let sumCurrent = 0;
  let sumInterest = 0;
  let sumClosePlusInt = 0;

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const party = escHtml(metadata.partyName);
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
    ? '<th class="amount">Int days</th><th class="amount">Interest</th><th class="amount">Closing+int</th>'
    : '';
  const intBlank = useInt ? '<td class="amount" style="opacity:.65">—</td><td class="amount" style="opacity:.65">—</td><td class="amount" style="opacity:.65">—</td>' : '';

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
    bodyRows += `
            <tr>
              <td class="col-vr">${escHtml(row.BILL_NO ?? row.bill_no ?? '')}</td>
              <td class="col-date">${billDt}</td>
              <td class="col-type">${escHtml(row.B_TYPE ?? row.b_type ?? '')}</td>
              <td class="col-date">${vrDt}</td>
              <td class="col-vr">${escHtml(row.VR_NO ?? row.vr_no ?? '')}</td>
              <td class="col-type">${escHtml(row.VR_TYPE ?? row.vr_type ?? '')}</td>
              <td class="amount">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount bal">${formatAmtPdf(row.CL_BALANCE ?? row.cl_balance)}</td>
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
      ? `<td class="amount"><strong>${idaysEsc}</strong></td><td class="amount bill-ledger-interest-amt-pdf"><strong>${formatAmtPdf(intAmt)}</strong></td><td class="amount"><strong>${formatAmtPdf(closePlus)}</strong></td>`
      : '';
    bodyRows += `
            <tr class="subtotal-row">
              <td colspan="6" class="col-name"><strong>Bill total — ${billDt} / ${bn} / ${bt}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(billCr)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(billDr)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(billCurrent)}</strong></td>
              ${intCells}
            </tr>`;
    sumCurrent += billCurrent;
    billDr = 0;
    billCr = 0;
    billCurrent = 0;
  });

  const intGrand = useInt
    ? `<td class="amount"><strong>—</strong></td><td class="amount bill-ledger-interest-amt-pdf"><strong>${formatAmtPdf(sumInterest)}</strong></td><td class="amount"><strong>${formatAmtPdf(sumClosePlusInt)}</strong></td>`
    : '';
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

      <table class="table-report">
        <thead>
          <tr>
            <th>Bill no</th>
            <th>Bill date</th>
            <th>B type</th>
            <th>Vr date</th>
            <th>Vr no</th>
            <th>Vr type</th>
            <th class="amount">Cr</th>
            <th class="amount">Dr</th>
            <th class="amount">Current bal</th>
            ${intHead}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="6" class="lbl-total">GRAND TOTAL <span style="font-weight:600;opacity:.9">(Dr/Cr sums + current bal total${useInt ? '; interest from GETINT' : ''})</span></td>
            <td class="amount">${formatAmtPdf(sumCr)}</td>
            <td class="amount">${formatAmtPdf(sumDr)}</td>
            <td class="amount">${formatAmtPdf(sumCurrent)}</td>
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
  const brk = escHtml(metadata.brokerRange ?? '');
  const party = escHtml(metadata.partyLabel ?? '');
  const filt = escHtml(metadata.filterLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let bodyRows = '';
  displayRows.forEach((item) => {
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
      const bk = escHtml(item.BK_CODE ?? '');
      bodyRows += `
            <tr class="broker-os-pdf-broker-total">
              <td colspan="8" class="col-name"><strong>Broker total — ${bk}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount">—</td>
              <td class="amount">—</td>
            </tr>`;
      return;
    }
    const row = item.row;
    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const vrDt = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    bodyRows += `
            <tr>
              <td class="col-code">${escHtml(row.BK_CODE ?? row.bk_code ?? '')}</td>
              <td class="col-code">${escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-name">${escHtml(row.NAME ?? row.name ?? '')}</td>
              <td class="col-vr">${escHtml(row.BILL_NO ?? row.bill_no ?? '')}</td>
              <td class="col-date">${billDt}</td>
              <td class="col-type">${escHtml(row.VR_TYPE ?? row.vr_type ?? '')}</td>
              <td class="col-date">${vrDt}</td>
              <td class="col-vr">${escHtml(row.VR_NO ?? row.vr_no ?? '')}</td>
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
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Broker range</td><td class="val">${brk}</td></tr>
          <tr><td class="lbl">Party filter</td><td class="val" colspan="3">${party}</td></tr>
          <tr><td class="lbl">Bill dates</td><td class="val">${period}</td><td class="lbl">Payment ending</td><td class="val">${payEnd}</td></tr>
          <tr><td class="lbl">Filter</td><td class="val" colspan="3">${filt}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report">
        <thead>
          <tr>
            <th>Bk</th>
            <th>Code</th>
            <th>Party</th>
            <th>Bill</th>
            <th>Bill dt</th>
            <th>Vr typ</th>
            <th>Vr dt</th>
            <th>Vr no</th>
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
    const taxCells = !isBillOfSupplyNoTax
      ? `
              <td class="num">${formatAmtPdf(row.DIS_AMT ?? row.dis_amt)}</td>
              <td class="num">${formatAmtPdf(row.TAXABLE ?? row.taxable)}</td>
              <td class="num">${formatAmtPdf(row.CGST_AMT ?? row.cgst_amt)}</td>
              <td class="num">${formatAmtPdf(row.SGST_AMT ?? row.sgst_amt)}</td>
              <td class="num">${formatAmtPdf(row.IGST_AMT ?? row.igst_amt)}</td>`
      : '';
    bodyRows += `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(sbCell(row, 'ITEM_NAME', 'item_name'))}</td>
              <td>${escHtml(sbCell(row, 'HSN_CODE', 'hsn_code'))}</td>
              <td class="num">${formatQtyPdf(row.QNTY ?? row.qnty)}</td>
              <td class="num">${formatQtyPdf(row.WEIGHT ?? row.weight)}</td>
              <td class="num">${formatAmtPdf(row.RATE ?? row.rate)}</td>
              <td class="num">${formatAmtPdf(row.AMOUNT ?? row.amount)}</td>
              ${taxCells}
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
      <div class="sb-pdf-irn">
        <div>IRN: ${escHtml(rowFieldCI(f, 'irn_no') || '—')}</div>
        <div>ACK: ${escHtml(rowFieldCI(f, 'ack_no') || '—')}</div>
        <div>E-Way: ${escHtml(rowFieldCI(f, 'eway_no') || '—')}</div>
      </div>

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
            <th>HSN</th>
            <th class="num">Qty</th>
            <th class="num">Wt</th>
            <th class="num">Rate</th>
            <th class="num">Amt</th>
            ${
              !isBillOfSupplyNoTax
              ? `<th class="num">Disc</th><th class="num">Taxable</th><th class="num">${escHtml(cgstLabel)}</th><th class="num">${escHtml(sgstLabel)}</th><th class="num">${escHtml(igstLabel)}</th>`
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
              ${
                !isBillOfSupplyNoTax
                  ? `${Math.abs(Number(t.disAmt || 0)) > 0.0001 ? `<tr><td>Discount</td><td class="num">${formatAmtPdf(t.disAmt)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumTax || 0)) > 0.0001 ? `<tr><td>Total taxable</td><td class="num">${formatAmtPdf(t.sumTax)}</td></tr>` : ''}
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
  const wordsRaw =
    billAmtNum < 0 ? 'Minus ' + rupeesToWords(Math.abs(billAmtNum)) : rupeesToWords(billAmtNum || Number(t.sumAmt) || 0);
  const words = escHtml(wordsRaw);

  let bodyRows = '';
  (lines || []).forEach((row, i) => {
    bodyRows += `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(sbCell(row, 'ITEM_CODE', 'item_code'))}</td>
              <td>${escHtml(sbCell(row, 'ITEM_NAME', 'item_name'))}</td>
              <td class="num">${formatQtyPdf(purchaseDnSigned(row, 'QNTY', 'qnty'))}</td>
              <td class="num">${formatQtyPdf(purchaseDnSigned(row, 'WEIGHT', 'weight'))}</td>
              <td class="num">${formatAmtPdf(stockNum(row, 'RATE', 'rate'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'AMOUNT', 'amount'))}</td>
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

  const sumPairs = [
    ['Total amount', t.sumAmt],
    ['Taxable', t.sumTax],
    ['CGST', t.sumC],
    ['SGST', t.sumS],
    ['IGST', t.sumI],
    ['Discount', t.sumDis],
    ['Oth exp 1', t.oth1],
    ['Oth exp 2', t.oth2],
    ['Oth exp 3', t.oth3],
    ['Oth exp 4', t.oth4],
    ['Oth exp 5', t.oth5],
    ['Oth exp 6', t.oth6],
    ['Oth exp 7', t.oth7],
    ['Oth exp 8', t.oth8],
    ['Broker paid', t.brokPaid],
    ['Freight paid', t.freightPaid],
    ['Mandi exp', t.mandiExp],
    ['Labour exp', t.labourExp],
    ['Bardana exp', t.bardanaExp],
    ['CD amount', t.cdAmount],
    ['Dharm kanta', t.dharmKanta],
    ['Tulwai exp', t.tulwaiExp],
    ['Round off', t.roundOff],
    ['Bill amt', t.billAmt],
  ];
  let sumBody = '';
  sumPairs.forEach(([lbl, val]) => {
    sumBody += `<tr><td>${escHtml(lbl)}</td><td class="num">${formatAmtPdf(val)}</td></tr>`;
  });

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
        <span><strong>R no.</strong> ${escHtml(String(f.R_NO ?? f.r_no ?? '—'))}</span>
        <span><strong>R date</strong> ${escHtml(formatLedgerDateDisplay(f.R_DATE ?? f.r_date))}</span>
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
            <th class="num">Qty</th>
            <th class="num">Wt</th>
            <th class="num">Rate</th>
            <th class="num">Amt</th>
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
function buildPurchaseListReportHtml(data, metadata) {
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

export function buildReportHtml(reportType, data, metadata) {
  if (reportType === 'ledger') return buildLedgerReportHtml(data, metadata);
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
      : { scale: 2, useCORS: true };

  return {
    margin: reportType === 'sale-bill' || reportType === 'purchase-bill' ? 8 : 10,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas,
    jsPDF: {
      orientation: reportType === 'sale-bill' || reportType === 'purchase-bill' ? 'portrait' : 'landscape',
      unit: 'mm',
      format: 'a4',
    },
  };
}

/**
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function getPdfBlob(reportType, data, metadata) {
  const htmlContent = buildReportHtml(reportType, data, metadata);
  const options = getPdfOptions(metadata, reportType);
  const blob = await html2pdf().set(options).from(htmlContent).outputPdf('blob');
  return { blob, filename: options.filename };
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

/** Download PDF (browser save dialog). */
export const generatePDF = async (reportType, data, metadata) => {
  const { blob, filename } = await getPdfBlob(reportType, data, metadata);
  downloadBlob(blob, filename);
};

/**
 * WhatsApp + PDF: same flow for trial-balance and ledger.
 * On mobile, uses Web Share API so the PDF can be attached directly to WhatsApp when supported.
 * Otherwise downloads the PDF and opens wa.me with instructions to attach from Downloads.
 */
export async function sharePdfWithWhatsApp(reportType, data, metadata, shareText) {
  const { blob, filename } = await getPdfBlob(reportType, data, metadata);
  const file = new File([blob], filename, { type: 'application/pdf' });
  const reportLabel =
    reportType === 'trial-balance'
      ? 'Trial Balance'
      : reportType === 'bill-ledger'
        ? metadata?.billLedgerTitle || 'CustomerLedger'
        : reportType === 'broker-os'
          ? 'Broker outstanding'
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
                        : 'Ledger';
  const text =
    shareText || `${metadata.companyName}\n${reportLabel}\n${metadata.endDate || ''}`;

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: text.split('\n')[0],
        text,
      });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  downloadBlob(blob, filename);
  const body =
    text +
    '\n\nPDF saved as: ' +
    filename +
    '\nIn WhatsApp, tap Attach (paperclip) and select this file from your Downloads folder.';
  window.open(`https://wa.me/?text=${encodeURIComponent(body)}`, '_blank', 'noopener,noreferrer');
}
