import axios from 'axios';
import { toDisplayDate } from './dateFormat';
import {
  downloadCombinedReportPdf,
  getCombinedReportPdfBlob,
  printPdfBlob,
  sharePdfWithWhatsApp,
} from './pdfgenerator';
import { mapCompdetPrintHeader } from './voucherPrint';

const reqOpts = { withCredentials: true, timeout: 120000 };

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v) {
  return toDisplayDate(v) || String(v || '').trim();
}

function fmt(v, decimals = 2) {
  return num(v).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function statusUnit(status) {
  const s = String(status || 'B').trim().toUpperCase();
  if (s === 'B') return 'BAGS';
  if (s === 'K') return 'KATTA';
  if (s === 'H') return 'HKATTA';
  return '';
}

function detailLine(label, value) {
  if (value == null || String(value).trim() === '') return '';
  return `<div><strong>${esc(label)}:</strong> ${esc(value)}</div>`;
}

function partyStateLine(h) {
  const code = String(h.party_state_code || '').trim();
  const state = String(h.party_state || '').trim();
  if (code && state) return `${code}-${state}`;
  return code || state || '';
}

export function normalizeDispatchChallanPrint(data) {
  const h = data?.header || {};
  const lines = (Array.isArray(data?.lines) ? data.lines : [])
    .filter((ln) => ln.item_code || ln.item_name)
    .map((ln, idx) => {
      const status = String(ln.status || 'B').trim().toUpperCase() || 'B';
      return {
        sno: idx + 1,
        item_code: ln.item_code,
        item_name: String(ln.item_name || '').trim(),
        hsn_code: String(ln.hsn_code || '').trim(),
        status,
        status_unit: statusUnit(status),
        qnty: num(ln.qnty),
        packing: num(ln.packing),
        weight: num(ln.weight),
        rate: num(ln.rate),
        amount: num(ln.amount),
      };
    });
  const totals = lines.reduce(
    (t, ln) => ({
      qnty: t.qnty + ln.qnty,
      packing: t.packing + ln.packing,
      weight: t.weight + ln.weight,
      amount: t.amount + ln.amount,
    }),
    { qnty: 0, packing: 0, weight: 0, amount: 0 }
  );
  const bType = String(h.b_type || 'N').trim() || 'N';
  const billNo = h.bill_no != null ? String(h.bill_no) : '';
  // VFP dcpnt shows Ch. No. like "1N" (bill_no + b_type).
  const chNo = String(h.ch_print_no || `${billNo}${bType}`).trim();
  return {
    header: {
      ...h,
      bill_no: billNo,
      b_type: bType,
      bill_date: fmtDate(h.bill_date),
      ch_no: chNo,
      party_name: String(h.party_name || '').trim(),
      party_add1: String(h.party_add1 || '').trim(),
      party_add2: String(h.party_add2 || '').trim(),
      party_add3: String(h.party_add3 || '').trim(),
      party_city: String(h.party_city || '').trim(),
      party_tel: String(h.party_tel || '').trim(),
      party_gst: String(h.party_gst || h.gst_no || '').trim(),
      party_pan: String(h.party_pan || h.pan || '').trim(),
      party_state: String(h.party_state || '').trim(),
      party_state_code: String(h.party_state_code || '').trim(),
      party_contact: String(h.party_contact || h.own_name1 || '').trim(),
      bk_name: String(h.bk_name || '').trim(),
      bk_add1: String(h.bk_add1 || '').trim(),
      bk_add2: String(h.bk_add2 || '').trim(),
      bk_city: String(h.bk_city || '').trim(),
      bk_tel: String(h.bk_tel || '').trim(),
      gr_no: String(h.gr_no || '').trim(),
      truck_no: String(h.truck_no || '').trim(),
      tpt: String(h.tpt || '').trim(),
      remarks: String(h.remarks || '').trim(),
      is_return: String(h.type || '').toUpperCase() === 'DR',
    },
    lines,
    totals: {
      qnty: num(data?.totals?.qnty ?? totals.qnty),
      packing: num(data?.totals?.packing ?? totals.packing),
      weight: num(data?.totals?.weight ?? totals.weight),
      amount: num(data?.totals?.amount ?? totals.amount),
    },
  };
}

export function buildDispatchChallanPrintPayloadFromForm(header, lines, totals, { dcType = 'DC' } = {}) {
  return normalizeDispatchChallanPrint({
    header: {
      ...header,
      type: dcType,
      ch_print_no: `${header?.bill_no ?? ''}${String(header?.b_type || 'N').trim() || 'N'}`,
    },
    lines,
    totals,
  });
}

async function fetchCompany(apiBase, compCode, compUid) {
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
    console.warn('DC print: company header unavailable', err?.message || err);
    return {};
  }
}

export async function fetchDispatchChallanPrintBundle(apiBase, apiParams, { billNo, bType, dcType }) {
  const params = {
    ...apiParams,
    dc_type: dcType || 'DC',
    bill_no: billNo,
    b_type: bType || 'N',
  };
  const { data } = await axios.get(`${apiBase}/api/dispatch-challan`, { params, ...reqOpts });
  return normalizeDispatchChallanPrint(data);
}

function buildMetadata(payload, company, formData, userName) {
  const h = payload?.header || {};
  const stamp = new Date().toISOString().split('T')[0];
  const companyName = company.companyName || formData?.comp_name || formData?.COMP_NAME || '';
  const title = h.is_return ? 'DISPATCH CHALLAN RETURN' : 'CHALLAN';
  return {
    companyName,
    company,
    documentTitle: title,
    billNo: h.bill_no,
    billDate: h.bill_date,
    preparedBy: userName || '',
    autoOpen: false,
    partyTel: h.party_tel || '',
    combinedFilename: `${String(companyName || 'Company').replace(/\s+/g, '_')}_${
      h.is_return ? 'DC_Return' : 'Dispatch_Challan'
    }_${h.bill_no || 'Print'}_${stamp}.pdf`,
  };
}

function buildChallanHtml(payload, company, metadata) {
  const h = payload.header;
  const title = h.is_return ? 'DC RETURN' : 'CHALLAN';
  const phLine = [company.tel1, company.tel2].filter(Boolean).join(', ');
  const partyAddress = [h.party_add1, h.party_add2, h.party_add3, h.party_city].filter((v) =>
    String(v || '').trim()
  );
  const customerName = h.party_contact || h.bk_name;
  const customerAddress = h.party_contact
    ? [h.party_city].filter((v) => String(v || '').trim())
    : [h.bk_add1, h.bk_add2, h.bk_city].filter((v) => String(v || '').trim());
  const nature = company.bHeader || company.billSlogan || '';
  const stateLine = partyStateLine(h);
  const body = payload.lines
    .map((ln) => {
      const qty = `${fmt(ln.qnty, 0)}${ln.status_unit ? esc(ln.status_unit) : ''}`;
      return `<tr>
        <td>${esc(ln.item_name)}</td>
        <td>${esc(ln.hsn_code)}</td>
        <td class="num">${qty}</td>
        <td class="num">${ln.packing ? fmt(ln.packing, 0) : ''}</td>
        <td class="num">${ln.weight ? fmt(ln.weight, 3) : ''}</td>
        <td class="num">${ln.rate ? fmt(ln.rate) : ''}</td>
        <td class="num">${ln.amount ? fmt(ln.amount) : ''}</td>
      </tr>`;
    })
    .join('');
  const t = payload.totals;
  return `<section class="dc-print-copy">
    <table class="dc-print-top"><tbody><tr>
      <td class="dc-print-top__side">
        ${detailLine('GSTIN', company.gst)}
        ${detailLine('EMAIL', company.email)}
        ${detailLine('PAN', company.pan)}
      </td>
      <td class="dc-print-top__title">${esc(title)}</td>
      <td class="dc-print-top__side dc-print-top__side--right">
        ${detailLine('PH.', phLine)}
        ${detailLine('FAX', company.tel3)}
        ${detailLine('CIN', company.cin)}
      </td>
    </tr></tbody></table>
    <div class="dc-print-company">
      <div class="dc-print-company__name">${esc(company.companyName || metadata.companyName)}</div>
      ${nature ? `<div class="dc-print-company__nature">${esc(nature)}</div>` : ''}
      ${company.add1 ? `<div>${esc(company.add1)}</div>` : ''}
      ${company.add2 ? `<div>${esc(company.add2)}</div>` : ''}
    </div>
    <div class="dc-print-party-row">
      <div class="dc-print-party">
        <div>M/s <strong>${esc(h.party_name)}</strong></div>
        ${partyAddress.map((line) => `<div>${esc(line)}</div>`).join('')}
        <div>Tel : ${esc(h.party_tel || '')} &nbsp;&nbsp; Fax :</div>
        <div>State : ${esc(stateLine || '—')}</div>
        <div>Gst.No. : ${esc(h.party_gst || '')}</div>
        <div>PAN : ${esc(h.party_pan || '')}</div>
        ${
          customerName
            ? `<div class="dc-print-customer">Customer <strong>${esc(customerName)}</strong></div>
               ${customerAddress.map((line) => `<div>${esc(line)}</div>`).join('')}`
            : ''
        }
      </div>
      <table class="dc-print-meta"><tbody>
        <tr><td class="label">Ch. No.</td><td>${esc(h.ch_no)}</td></tr>
        <tr><td class="label">Dated</td><td>${esc(h.bill_date)}</td></tr>
      </tbody></table>
    </div>
    ${h.remarks ? `<div class="dc-print-remarks">${esc(h.remarks)}</div>` : '<div class="dc-print-remarks">&nbsp;</div>'}
    <table class="dc-print-table">
      <thead>
        <tr>
          <th>Particulars</th>
          <th>HsnCode</th>
          <th class="num">Qty.</th>
          <th class="num">Pkg.</th>
          <th class="num">Weight</th>
          <th class="num">Rate</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>${body || '<tr><td colspan="7">(No items)</td></tr>'}</tbody>
      <tfoot>
        <tr>
          <td colspan="2"><strong>TOTAL AMOUNT APPROX.</strong></td>
          <td class="num"><strong>${fmt(t.qnty, 0)}</strong></td>
          <td></td>
          <td class="num"><strong>${fmt(t.weight, 3)}</strong></td>
          <td></td>
          <td class="num"><strong>${fmt(t.amount)}</strong></td>
        </tr>
      </tfoot>
    </table>
    <div class="dc-print-transport">
      <div>Truck No. ${esc(h.truck_no)}</div>
      <div>G.R.No. ${esc(h.gr_no)}</div>
    </div>
    <div class="dc-print-tpt">Tpt ${esc(h.tpt)}</div>
    <div class="dc-print-sign">
      <div>For ${esc(company.companyName || metadata.companyName)}</div>
      <div class="dc-print-sign__auth">Auth.Signatory</div>
    </div>
  </section>`;
}

export function buildDispatchChallanPrintHtml(payload, metadata) {
  const company = metadata?.company || {};
  const normalized = normalizeDispatchChallanPrint(payload);
  return `<div class="dc-print report-doc">
    <style>
      * { box-sizing: border-box; }
      .dc-print { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #111; }
      .dc-print-copy { page-break-after: always; padding: 4px 6px; }
      .dc-print-copy:last-child { page-break-after: auto; }
      .dc-print-top { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
      .dc-print-top td { border: 0; vertical-align: top; padding: 0 2px; line-height: 1.25; }
      .dc-print-top__side { width: 30%; font-size: 9px; }
      .dc-print-top__side--right { text-align: right; }
      .dc-print-top__title { text-align: center; font-size: 16px; font-weight: 700; letter-spacing: .6px; text-decoration: underline; }
      .dc-print-company { text-align: center; line-height: 1.3; margin: 2px 0 8px; }
      .dc-print-company__name { font-size: 18px; font-weight: 700; text-transform: uppercase; }
      .dc-print-company__nature { font-size: 10px; font-weight: 600; }
      .dc-print-party-row { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 6px; }
      .dc-print-party { flex: 1; line-height: 1.35; }
      .dc-print-customer { margin-top: 6px; }
      .dc-print-meta { width: 180px; border-collapse: collapse; flex-shrink: 0; }
      .dc-print-meta td { border: 1px solid #444; padding: 3px 6px; }
      .dc-print-meta .label { width: 58px; font-weight: 600; background: #f7f7f7; }
      .dc-print-remarks { min-height: 14px; margin: 2px 0 4px; font-size: 10px; }
      .dc-print-table { width: 100%; border-collapse: collapse; margin-top: 2px; }
      .dc-print-table th, .dc-print-table td { border: 1px solid #555; padding: 3px 5px; vertical-align: top; }
      .dc-print-table thead th { background: #f3f3f3; text-align: left; font-weight: 700; }
      .dc-print-table .num, .dc-print-table th.num { text-align: right; }
      .dc-print-table tfoot td { border-top: 2px solid #222; font-weight: 700; }
      .dc-print-transport { display: flex; justify-content: space-between; margin-top: 10px; font-size: 10px; }
      .dc-print-tpt { margin-top: 2px; }
      .dc-print-sign { margin-top: 36px; text-align: right; font-weight: 600; line-height: 1.4; }
      .dc-print-sign__auth { margin-top: 28px; font-weight: 500; }
    </style>
    ${buildChallanHtml(normalized, company, metadata)}
  </div>`;
}

export async function buildDispatchChallanPrintContext(apiBase, ctx, payload) {
  const normalized = normalizeDispatchChallanPrint(payload);
  const company = await fetchCompany(apiBase, ctx.compCode, ctx.compUid);
  const metadata = buildMetadata(normalized, company, ctx.formData, ctx.userName);
  return { payload: normalized, metadata, company };
}

export function buildDispatchChallanPrintPreviewHtml(payload, metadata) {
  return buildDispatchChallanPrintHtml(payload, metadata);
}

export async function exportDispatchChallanPdf(apiBase, ctx, payload) {
  const { payload: normalized, metadata } = await buildDispatchChallanPrintContext(apiBase, ctx, payload);
  await downloadCombinedReportPdf(
    'purchase-order-print',
    [buildDispatchChallanPrintHtml(normalized, metadata)],
    metadata
  );
}

export async function printDispatchChallanBrowser(apiBase, ctx, payload) {
  const { payload: normalized, metadata } = await buildDispatchChallanPrintContext(apiBase, ctx, payload);
  const { blob } = await getCombinedReportPdfBlob(
    'purchase-order-print',
    [buildDispatchChallanPrintHtml(normalized, metadata)],
    metadata
  );
  await printPdfBlob(blob);
}

export async function shareDispatchChallanWhatsApp(apiBase, ctx, payload) {
  const { payload: normalized, metadata } = await buildDispatchChallanPrintContext(apiBase, ctx, payload);
  const { blob, filename } = await getCombinedReportPdfBlob(
    'purchase-order-print',
    [buildDispatchChallanPrintHtml(normalized, metadata)],
    metadata
  );
  const label = normalized.header.is_return ? 'DC Return' : 'Dispatch Challan';
  const shareText = `${metadata.companyName} — ${label} No. ${metadata.billNo} dated ${metadata.billDate}`;
  await sharePdfWithWhatsApp('purchase-order-print', normalized, metadata, shareText, {
    prebuiltBlob: blob,
    prebuiltFilename: filename,
  });
}
