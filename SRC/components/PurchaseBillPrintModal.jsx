import React, { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { rupeesToWords } from '../utils/rupeesInWords';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelWorkbook } from '../utils/excelExport';
import { rowFieldCI, rowFieldAny } from '../utils/rowFieldCI';
import { runWindalSaleBillPrint } from '../utils/windalBrowserPrint';
import { signedQrCodeToDataUrl } from '../utils/qrDataUrl';

function v(row, upper, lower) {
  if (!row) return '';
  const x = row[upper] ?? row[lower];
  return x != null && x !== '' ? String(x) : '';
}

function n(row, upper, lower) {
  const x = row?.[upper] ?? row?.[lower];
  if (x == null || x === '') return 0;
  const p = parseFloat(x);
  return Number.isNaN(p) ? 0 : p;
}

function isDnRow(row) {
  return String(row?.TYPE ?? row?.type ?? '').trim().toUpperCase() === 'DN';
}

function signedLine(row, upper, lower) {
  const x = n(row, upper, lower);
  return isDnRow(row) ? -Math.abs(x) : x;
}

function scalarDn(firstRow, upper, lower) {
  const x = n(firstRow, upper, lower);
  return isDnRow(firstRow) ? -Math.abs(x) : x;
}

function fmtAmt(val) {
  const x = parseFloat(val) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(val) {
  const x = parseFloat(val);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function amountWords(billAmt) {
  const x = Number(billAmt);
  if (Number.isNaN(x)) return '';
  if (x < 0) return 'Minus ' + rupeesToWords(Math.abs(x));
  return rupeesToWords(x);
}

/** Accept entry-form { r_date, r_no } or report { oracleDt, rNo }. */
function resolveBillPrintKeys(billParams) {
  if (!billParams || typeof billParams !== 'object') return { type: 'PU', oracleDt: '', rNo: '', label: '' };
  return {
    type: String(billParams.type || billParams.TYPE || 'PU').trim() || 'PU',
    oracleDt: String(billParams.oracleDt || billParams.r_date || billParams.R_DATE || '').trim(),
    rNo: String(billParams.rNo ?? billParams.r_no ?? billParams.R_NO ?? '').trim(),
    label: billParams.label || '',
  };
}

export default function PurchaseBillPrintModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  billParams,
  companyName = '',
  einvMode = false,
}) {
  const [header, setHeader] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const keys = useMemo(() => resolveBillPrintKeys(billParams), [billParams]);

  useEffect(() => {
    if (!open || !billParams) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, billParams, onClose]);

  useEffect(() => {
    if (!open || !billParams || !compCode || !compUid) return undefined;
    if (!keys.oracleDt || !keys.rNo) {
      setErr('Bill date and number are required for print.');
      setLines([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      setHeader(null);
      setLines([]);
      try {
        const [hRes, lRes] = await Promise.all([
          axios.get(`${apiBase}/api/compdet-print-header`, {
            params: { comp_code: compCode, comp_uid: compUid },
            withCredentials: true,
            timeout: 120000,
          }),
          axios.get(`${apiBase}/api/purchase-bill-print`, {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              type: keys.type,
              r_date: keys.oracleDt,
              r_no: keys.rNo,
            },
            withCredentials: true,
            timeout: 120000,
          }),
        ]);
        if (cancelled) return;
        setHeader(hRes.data || null);
        setLines(Array.isArray(lRes.data) ? lRes.data : []);
      } catch (e) {
        if (!cancelled) {
          setErr(e.response?.data?.error || e.message || 'Failed to load bill');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, billParams, apiBase, compCode, compUid, keys.type, keys.oracleDt, keys.rNo]);

  const first = lines[0];

  const docTitle = useMemo(() => {
    // Prefer explicit requested print type (DX/CX/DN/etc) over whatever TYPE comes back from the query.
    const t = String(keys.type ?? first?.TYPE ?? first?.type ?? '').trim().toUpperCase();
    if (t === 'DN') return 'DEBIT NOTE';
    if (t === 'PB') return 'BARDANA PURCHASE BILL';
    if (t === 'EV') return 'EXPENSES VOUCHER';
    if (t === 'DX') return 'DEBIT NOTE';
    if (t === 'CX') return 'CREDIT NOTE';
    return 'PURCHASE BILL';
  }, [first, keys.type]);

  const billTypeUc = String(keys.type || first?.TYPE || first?.type || '')
    .trim()
    .toUpperCase();
  const isPbPrint = billTypeUc === 'PB';
  const isDebitPrint = billTypeUc === 'DN' || billTypeUc === 'DX';
  const isCreditPrint = billTypeUc === 'CX' || billTypeUc === 'CN';
  const isEvPrint = billTypeUc === 'EV';
  const noLabel = isDebitPrint ? 'Debit Note No.' : isCreditPrint ? 'Credit Note No.' : 'R no.';
  const dateLabel = isDebitPrint
    ? 'Debit Note Date'
    : isCreditPrint
      ? 'Credit Note Date'
      : 'R date';

  const totals = useMemo(() => {
    let sumAmt = 0;
    let sumTax = 0;
    let sumC = 0;
    let sumS = 0;
    let sumI = 0;
    let sumDis = 0;
    let sumFreight = 0;
    let sumQty = 0;
    let sumWgt = 0;
    for (const r of lines) {
      sumAmt += signedLine(r, 'AMOUNT', 'amount');
      sumTax += signedLine(r, 'TAXABLE', 'taxable');
      sumC += signedLine(r, 'CGST_AMT', 'cgst_amt');
      sumS += signedLine(r, 'SGST_AMT', 'sgst_amt');
      sumI += signedLine(r, 'IGST_AMT', 'igst_amt');
      sumDis += signedLine(r, 'DIS_AMT', 'dis_amt');
      sumFreight += signedLine(r, 'FREIGHT', 'freight');
      sumQty += signedLine(r, 'QNTY', 'qnty');
      sumWgt += signedLine(r, 'WEIGHT', 'weight');
    }
    const empty = {
      sumAmt,
      sumTax,
      sumC,
      sumS,
      sumI,
      sumDis,
      sumFreight,
      sumQty,
      sumWgt,
      billAmt: 0,
      oth1: 0,
      oth2: 0,
      oth3: 0,
      oth4: 0,
      oth5: 0,
      oth6: 0,
      oth7: 0,
      oth8: 0,
      othName1: '',
      othName2: '',
      othName3: '',
      othName4: '',
      othName5: '',
      othName6: '',
      othName7: '',
      othName8: '',
      brokPaid: 0,
      freightPaid: 0,
      mandiExp: 0,
      labourExp: 0,
      bardanaExp: 0,
      cdAmount: 0,
      dharmKanta: 0,
      tulwaiExp: 0,
      roundOff: 0,
      ntdsAmt: 0,
      tcsAmt: 0,
      commAmt: 0,
      mudAmt: 0,
      brokAmt: 0,
    };
    if (!first) return empty;
    return {
      ...empty,
      billAmt: scalarDn(first, 'BILL_AMT', 'bill_amt'),
      oth1: scalarDn(first, 'OTH_EXP_1', 'oth_exp_1'),
      oth2: scalarDn(first, 'OTH_EXP_2', 'oth_exp_2'),
      oth3: scalarDn(first, 'OTH_EXP_3', 'oth_exp_3'),
      oth4: scalarDn(first, 'OTH_EXP_4', 'oth_exp_4'),
      oth5: scalarDn(first, 'OTH_EXP_5', 'oth_exp_5'),
      oth6: scalarDn(first, 'OTH_EXP_6', 'oth_exp_6'),
      oth7: scalarDn(first, 'OTH_EXP_7', 'oth_exp_7'),
      oth8: scalarDn(first, 'OTH_EXP_8', 'oth_exp_8'),
      othName1: v(first, 'OTH_NAME1', 'oth_name1'),
      othName2: v(first, 'OTH_NAME2', 'oth_name2'),
      othName3: v(first, 'OTH_NAME3', 'oth_name3'),
      othName4: v(first, 'OTH_NAME4', 'oth_name4'),
      othName5: v(first, 'OTH_NAME5', 'oth_name5'),
      othName6: v(first, 'OTH_NAME6', 'oth_name6'),
      othName7: v(first, 'OTH_NAME7', 'oth_name7'),
      othName8: v(first, 'OTH_NAME8', 'oth_name8'),
      brokPaid: scalarDn(first, 'BROK_PAID', 'brok_paid'),
      freightPaid: scalarDn(first, 'FREIGHT_PAID', 'freight_paid'),
      mandiExp: scalarDn(first, 'MANDI_EXP', 'mandi_exp'),
      labourExp: scalarDn(first, 'LABOUR_EXP', 'labour_exp'),
      bardanaExp: scalarDn(first, 'BARDANA_EXP', 'bardana_exp'),
      cdAmount: scalarDn(first, 'CD_AMOUNT', 'cd_amount'),
      dharmKanta: scalarDn(first, 'DHARM_KANTA', 'dharm_kanta'),
      tulwaiExp: scalarDn(first, 'TULWAI_EXP', 'tulwai_exp'),
      roundOff: scalarDn(first, 'ROUND_OFF', 'round_off'),
      ntdsAmt: scalarDn(first, 'NTDS_AMT', 'ntds_amt'),
      tcsAmt: scalarDn(first, 'TCS_AMT', 'tcs_amt'),
      commAmt: scalarDn(first, 'COMM_AMT', 'comm_amt'),
      mudAmt: scalarDn(first, 'MUD_AMT', 'mud_amt'),
      brokAmt: scalarDn(first, 'BROK_AMT', 'brok_amt'),
    };
  }, [lines, first]);

  const netPayable = useMemo(() => {
    const bill = Number(totals.billAmt) || 0;
    const tds = Number(totals.ntdsAmt) || 0;
    return bill - tds;
  }, [totals.billAmt, totals.ntdsAmt]);

  const amountInWords = useMemo(() => {
    const hasTds = Math.abs(Number(totals.ntdsAmt) || 0) > 0.0001;
    return amountWords(hasTds ? netPayable : totals.billAmt || totals.sumAmt);
  }, [totals.billAmt, totals.sumAmt, totals.ntdsAmt, netPayable]);

  const pdfData = useMemo(() => {
    if (!lines.length || !first) return null;
    return { lines, header, first, docTitle, totals: { ...totals, netPayable } };
  }, [lines, header, first, docTitle, totals, netPayable]);

  const compDisplayName = useMemo(() => {
    const fromDet = rowFieldCI(header || {}, 'comp_name');
    const fromForm = String(companyName || '').trim();
    return (fromDet || fromForm || 'Company').trim();
  }, [header, companyName]);

  const pdfMeta = useMemo(
    () => ({
      companyName: compDisplayName,
      purchaseBillKey: keys.rNo
        ? `${String(keys.type || '')}_${String(keys.rNo || '')}`.replace(/[^\w.-]+/g, '_')
        : 'bill',
    }),
    [compDisplayName, keys]
  );

  const handlePrint = useCallback(() => {
    if (!pdfData) return;
    runWindalSaleBillPrint();
  }, [pdfData]);

  const handleDownloadPdf = useCallback(() => {
    if (!pdfData) return;
    generatePDF('purchase-bill', pdfData, pdfMeta).catch((e) => alert(String(e?.message || e)));
  }, [pdfData, pdfMeta]);

  const handleDownloadExcel = useCallback(() => {
    if (!lines.length) return;
    try {
      const sheets = [{ name: 'Lines', data: lines }];
      if (header && typeof header === 'object' && Object.keys(header).length) {
        sheets.unshift({ name: 'Company', data: [header] });
      }
      downloadExcelWorkbook(sheets, `${compDisplayName}_PurchaseBill`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  }, [lines, header, compDisplayName]);

  const handleShareWhatsApp = useCallback(() => {
    if (!pdfData) return;
    const shareText = [
      `${docTitle} — ${v(first, 'BILL_NO', 'bill_no') || keys.rNo || '—'}`,
      compDisplayName,
      formatLedgerDateDisplay(first?.BILL_DATE ?? first?.bill_date),
      `Amount: ${fmtAmt(Math.abs(Number(totals.ntdsAmt) || 0) > 0.0001 ? netPayable : totals.billAmt || totals.sumAmt)}`,
    ].join('\n');
    sharePdfWithWhatsApp('purchase-bill', pdfData, pdfMeta, shareText).catch((e) =>
      alert(String(e?.message || e))
    );
  }, [pdfData, pdfMeta, first, compDisplayName, docTitle, keys.rNo, totals.billAmt, totals.sumAmt, totals.ntdsAmt, netPayable]);

  const qrImgSrc = useMemo(() => {
    if (!first) return '';
    const raw =
      first.SIGNED_QR_CODE ?? first.signed_qr_code ?? rowFieldCI(first, 'signed_qr_code');
    const dataUrl = signedQrCodeToDataUrl(raw);
    return dataUrl && String(dataUrl).startsWith('data:image/') ? dataUrl : '';
  }, [first]);

  if (!open || !billParams) return null;

  const h = header || {};
  const compAdd1 = rowFieldAny(h, ['comp_add1', 'compadd1', 'address1']);
  const compAdd2 = rowFieldAny(h, ['comp_add2', 'compadd2', 'address2']);
  const compAdd3 = rowFieldAny(h, ['comp_add3', 'compadd3', 'address3']);
  const tel1 = rowFieldAny(h, ['comp_tel1', 'comptel1', 'tel1', 'phone1']);
  const tel2 = rowFieldAny(h, ['comp_tel2', 'comptel2', 'tel2', 'phone2']);
  const gstNo = rowFieldAny(h, ['gst_no', 'gstno', 'comp_gst', 'gstin']);
  const compPan = rowFieldAny(h, ['comp_pan', 'pan', 'company_pan']);
  const email = rowFieldCI(h, 'email');
  const bankAcNo = rowFieldAny(h, ['bank_ac_no', 'BANK_AC_NO']);
  const bankAcNo1 = rowFieldAny(h, ['bank_ac_no1', 'BANK_AC_NO1']);
  const truckNo = first ? v(first, 'TRUCK', 'truck') : '';
  const tpt = first ? v(first, 'TPT', 'tpt') : '';
  const grNo = first ? v(first, 'GR_NO', 'gr_no') : '';
  const expLabel = (name, fallback) => (String(name || '').trim() ? String(name).trim() : fallback);
  const irnNo = first
    ? String(rowFieldCI(first, 'irn_no') || v(first, 'IRN_NO', 'irn_no') || '').trim()
    : '';
  const ackNo = first
    ? String(rowFieldCI(first, 'ack_no') || v(first, 'ACK_NO', 'ack_no') || '').trim()
    : '';

  const hasTds = Math.abs(Number(totals.ntdsAmt) || 0) > 0.0001;
  const sumRows = [
    ['Total amount', totals.sumAmt],
    isEvPrint ? ['Freight', totals.sumFreight] : ['Discount', totals.sumDis],
    ['Taxable', totals.sumTax],
    ['CGST', totals.sumC],
    ['SGST', totals.sumS],
    ['IGST', totals.sumI],
    [expLabel(totals.othName1, 'Oth exp 1'), totals.oth1],
    [expLabel(totals.othName2, 'Oth exp 2'), totals.oth2],
    [expLabel(totals.othName3, 'Oth exp 3'), totals.oth3],
    [expLabel(totals.othName4, 'Oth exp 4'), totals.oth4],
    [expLabel(totals.othName5, 'Oth exp 5'), totals.oth5],
    [expLabel(totals.othName6, 'Oth exp 6'), totals.oth6],
    [expLabel(totals.othName7, 'Oth exp 7'), totals.oth7],
    [expLabel(totals.othName8, 'Oth exp 8'), totals.oth8],
    ['Commission', totals.commAmt],
    ['Mudat', totals.mudAmt],
    ['Brokerage', totals.brokAmt],
    ...(isPbPrint || isEvPrint
      ? []
      : [
          ['Broker paid', totals.brokPaid],
          ['Freight paid', totals.freightPaid],
          ['Mandi exp', totals.mandiExp],
          ['Labour exp', totals.labourExp],
          ['Bardana exp', totals.bardanaExp],
          ['CD amount', totals.cdAmount],
          ['Dharm kanta', totals.dharmKanta],
          ['Tulwai exp', totals.tulwaiExp],
          ['Round off', totals.roundOff],
          ['TCS', totals.tcsAmt],
        ]),
    ...(isEvPrint
      ? [
          ...(Math.abs(Number(totals.tcsAmt) || 0) > 0.0001 ? [['TCS', totals.tcsAmt]] : []),
        ]
      : []),
    ['Bill amt', totals.billAmt],
    ...(hasTds
      ? [
          ['Less TDS', totals.ntdsAmt],
          ['Net Payable', netPayable],
        ]
      : []),
  ].filter(
    ([label, val]) =>
      label === 'Bill amt' ||
      label === 'Net Payable' ||
      label === 'Total amount' ||
      label === 'Discount' ||
      label === 'Freight' ||
      Math.abs(Number(val) || 0) > 0.0001
  );

  return (
    <div className="sale-bill-modal-backdrop sale-bill-print-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sale-bill-modal sale-bill-print-modal"
        role="dialog"
        aria-labelledby="purchase-bill-print-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sale-bill-modal-head no-print">
          <h3 id="purchase-bill-print-title">{einvMode ? 'E-Invoice Print' : keys.label || docTitle}</h3>
          <div className="sale-bill-print-actions">
            <button type="button" className="btn btn-export" disabled={!pdfData} onClick={handlePrint}>
              Print
            </button>
            <button type="button" className="btn btn-export" disabled={!pdfData} onClick={handleDownloadPdf}>
              Pdf
            </button>
            <button type="button" className="btn btn-excel" disabled={!lines.length} onClick={handleDownloadExcel}>
              Excel
            </button>
            <button type="button" className="btn btn-whatsapp" disabled={!pdfData} onClick={handleShareWhatsApp}>
              WhatsApp
            </button>
            <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="sale-bill-modal-body sale-bill-print-body">
          {loading ? <p className="sale-bill-modal-loading">Loading bill…</p> : null}
          {err ? (
            <p className="form-api-error" role="alert">
              {err}
            </p>
          ) : null}
          {!loading && !err && lines.length === 0 ? <p>No lines returned for this bill.</p> : null}

          {!loading && !err && lines.length > 0 ? (
            <div id="purchase-bill-print-area" className="sale-bill-print-doc purchase-bill-print-doc">
              <div className="sale-bill-print-doc-banner">
                <div className="sale-bill-print-banner-text">
                  <div className="sale-bill-print-doc-title">{docTitle}</div>
                  <div className="sale-bill-print-company">
                    {compDisplayName ? <div className="sale-bill-print-comp-name">{compDisplayName}</div> : null}
                    {compAdd1 ? <div>{compAdd1}</div> : null}
                    {compAdd2 ? <div>{compAdd2}</div> : null}
                    {compAdd3 ? <div>{compAdd3}</div> : null}
                    <div className="sale-bill-print-comp-meta">
                      {tel1 ? <span>Tel: {tel1}</span> : null}
                      {tel2 ? <span> {tel2}</span> : null}
                    </div>
                    <div>GstNo: {gstNo || '—'}</div>
                    <div>pan: {compPan || '—'}</div>
                    {email ? <div>EMAIL: {email}</div> : null}
                  </div>
                </div>
              </div>

              <hr className="sale-bill-print-footer-rule" style={{ margin: '0.5rem 0' }} />

              {einvMode ? (
                <div className="sale-bill-print-einv-head">
                  <div className="sale-bill-print-irn">
                    {irnNo ? <div>Irn No.: {irnNo}</div> : <div>Irn No.: —</div>}
                    {ackNo ? <div>Ack No.: {ackNo}</div> : null}
                  </div>
                  {qrImgSrc ? (
                    <div className="sale-bill-print-qr sale-bill-print-qr--totals">
                      <img src={qrImgSrc} alt="Signed invoice QR" />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="sale-bill-print-inv-row">
                <span>
                  <strong>{noLabel}</strong> {v(first, 'R_NO', 'r_no') || keys.rNo || '—'}
                </span>
                <span>
                  <strong>{dateLabel}</strong> {formatLedgerDateDisplay(first.R_DATE ?? first.r_date)}
                </span>
                <span>
                  <strong>Bill no.</strong> {v(first, 'BILL_NO', 'bill_no') || '—'}
                </span>
                <span>
                  <strong>Bill date</strong> {formatLedgerDateDisplay(first.BILL_DATE ?? first.bill_date)}
                </span>
              </div>

              <div className="sale-bill-print-two-col" style={{ gridTemplateColumns: '1fr' }}>
                <div className="sale-bill-print-col">
                  <div className="sale-bill-print-col-h">Party name</div>
                  <div>{v(first, 'NAME', 'name')}</div>
                  <div>{v(first, 'ADD1', 'add1')}</div>
                  <div>{v(first, 'ADD2', 'add2')}</div>
                  <div>{v(first, 'ADD3', 'add3')}</div>
                  <div>{v(first, 'CITY', 'city')}</div>
                  <div>GST: {v(first, 'GST_NO', 'gst_no')}</div>
                  <div>PAN: {v(first, 'PAN', 'pan')}</div>
                </div>
              </div>

              <div className="sale-bill-print-broker">
                <strong>Broker:</strong>{' '}
                {[v(first, 'BK_NAME', 'bk_name'), v(first, 'B_CODE', 'b_code')].filter(Boolean).join(' — ') || '—'}
              </div>

              <table className="sale-bill-print-table purchase-bill-print-table">
                <thead>
                  <tr>
                    <th>Sno</th>
                    <th>Item</th>
                    <th>Item name</th>
                    <th>HSN</th>
                    {!isEvPrint ? <th className="num">Qty</th> : null}
                    <th className="num">Weight</th>
                    <th className="num">Rate</th>
                    <th className="num">Amount</th>
                    <th className="num">{isEvPrint ? 'Freight' : 'Disc'}</th>
                    <th className="num">Taxable</th>
                    <th className="num">CGST</th>
                    <th className="num">SGST</th>
                    <th className="num">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{v(row, 'ITEM_CODE', 'item_code')}</td>
                      <td>{v(row, 'ITEM_NAME', 'item_name')}</td>
                      <td>{v(row, 'HSN_CODE', 'hsn_code')}</td>
                      {!isEvPrint ? (
                        <td className="num">{fmtQty(signedLine(row, 'QNTY', 'qnty'))}</td>
                      ) : null}
                      <td className="num">{fmtQty(signedLine(row, 'WEIGHT', 'weight'))}</td>
                      <td className="num">{fmtAmt(n(row, 'RATE', 'rate'))}</td>
                      <td className="num">{fmtAmt(signedLine(row, 'AMOUNT', 'amount'))}</td>
                      <td className="num">
                        {fmtAmt(
                          isEvPrint
                            ? signedLine(row, 'FREIGHT', 'freight')
                            : signedLine(row, 'DIS_AMT', 'dis_amt')
                        )}
                      </td>
                      <td className="num">{fmtAmt(signedLine(row, 'TAXABLE', 'taxable'))}</td>
                      <td className="num">{fmtAmt(signedLine(row, 'CGST_AMT', 'cgst_amt'))}</td>
                      <td className="num">{fmtAmt(signedLine(row, 'SGST_AMT', 'sgst_amt'))}</td>
                      <td className="num">{fmtAmt(signedLine(row, 'IGST_AMT', 'igst_amt'))}</td>
                    </tr>
                  ))}
                  <tr className="purchase-bill-print-line-total">
                    <td colSpan={4}>
                      <strong>Total</strong>
                    </td>
                    {!isEvPrint ? (
                      <td className="num">
                        <strong>{fmtQty(totals.sumQty)}</strong>
                      </td>
                    ) : null}
                    <td className="num">
                      <strong>{fmtQty(totals.sumWgt)}</strong>
                    </td>
                    <td />
                    <td className="num">
                      <strong>{fmtAmt(totals.sumAmt)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(isEvPrint ? totals.sumFreight : totals.sumDis)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.sumTax)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.sumC)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.sumS)}</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.sumI)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="sale-bill-print-sum-block">
                <table className="sale-bill-print-totals purchase-bill-print-totals">
                  <tbody>
                    {sumRows.map(([label, val]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td className="num">{fmtAmt(val)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="sale-bill-print-net-words-row" style={{ width: '100%', maxWidth: '420px' }}>
                  <div className="sale-bill-print-words-inline">
                    <strong>Rs in words:</strong> {amountInWords}
                  </div>
                </div>
              </div>

              <hr className="sale-bill-print-footer-rule" />

              {bankAcNo || bankAcNo1 ? (
                <div className="sale-bill-print-bank">
                  {bankAcNo ? <div>{bankAcNo}</div> : null}
                  {bankAcNo1 ? <div>{bankAcNo1}</div> : null}
                </div>
              ) : null}

              {truckNo || tpt || grNo ? (
                <div className="sale-bill-print-transport">
                  {truckNo ? (
                    <span className="sale-bill-print-transport-item">
                      <strong>Truck:</strong> {truckNo}
                    </span>
                  ) : null}
                  {tpt ? (
                    <span className="sale-bill-print-transport-item">
                      <strong>Tpt:</strong> {tpt}
                    </span>
                  ) : null}
                  {grNo ? (
                    <span className="sale-bill-print-transport-item">
                      <strong>GR no.:</strong> {grNo}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {v(first, 'REMARKS', 'remarks') ? (
                <div className="sale-bill-print-broker">
                  <strong>Remarks:</strong> {v(first, 'REMARKS', 'remarks')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
