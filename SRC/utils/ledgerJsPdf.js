import { jsPDF } from 'jspdf';
import { formatLedgerDateDisplay } from './dateFormat';

function formatAmtPdf(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function createJsPdfA4Portrait() {
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}

function pdfPageLayout(doc, marginMm = 8) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const lm = marginMm;
  const contentW = pw - lm * 2;
  return { pw, ph, lm, contentW };
}

function scalePdfCols(cols, contentW) {
  const total = cols.reduce((s, c) => s + c.w, 0);
  if (total <= 0) return cols;
  const scale = contentW / total;
  let used = 0;
  cols.forEach((c, i) => {
    if (i === cols.length - 1) {
      c.w = Math.max(8, contentW - used);
    } else {
      c.w = c.w * scale;
      used += c.w;
    }
  });
  return cols;
}

function pdfColLayout(cols, lm) {
  const xAt = [];
  let x = lm;
  cols.forEach((c) => {
    xAt.push(x);
    x += c.w;
  });
  return { xAt, tableW: x - lm };
}

/** Ledger PDF via jsPDF (reliable on mobile; html2pdf often renders blank pages). */
export function buildLedgerJsPdfBlob(data, metadata, pdfOpts = {}) {
  const rows = Array.isArray(data) ? data : [];
  const doc = pdfOpts.doc || createJsPdfA4Portrait();
  if (pdfOpts.doc) doc.addPage();
  const { pw, ph, lm, contentW } = pdfPageLayout(doc);
  const MIN_ROW_H = 5.8;
  const LINE_H = 3.1;
  const ROW_PAD_TOP = 2;
  const ROW_GAP = 0.6;
  const NAVY = [15, 30, 60];
  const ACCENT = [0, 194, 168];
  const INDIGO = [42, 79, 168];
  const PANEL = [234, 238, 253];
  const STRIPE = [244, 246, 251];
  const RED = [197, 48, 48];
  const GREEN = [47, 133, 90];
  const BORDER = [180, 192, 214];

  const cols = scalePdfCols(
    [
      { label: 'Vr dt', w: 17 },
      { label: 'Val dt', w: 17 },
      { label: 'No', w: 11 },
      { label: 'Vr', w: 9 },
      { label: 'Ty', w: 8 },
      { label: 'Detail', w: 58 },
      { label: 'Dr', w: 22, right: true, debit: true },
      { label: 'Cr', w: 22, right: true, credit: true },
      { label: 'Balance', w: 24, right: true },
    ],
    contentW
  );
  const { xAt, tableW } = pdfColLayout(cols, lm);

  const fillBand = (y0, h, rgb) => {
    doc.setFillColor(...rgb);
    doc.rect(lm, y0, contentW, h, 'F');
  };

  const hline = (y0, color = BORDER) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.25);
    doc.line(lm, y0, lm + tableW, y0);
  };

  let y = 8;

  fillBand(y, 10, NAVY);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(String(metadata?.ledgerBannerTitle || 'LEDGER ACCOUNT'), lm + contentW / 2, y + 6.5, { align: 'center' });
  y += 12;

  const panelH = 20;
  fillBand(y, panelH, PANEL);
  doc.setDrawColor(...INDIGO);
  doc.setLineWidth(0.35);
  doc.rect(lm, y, contentW, panelH, 'S');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(String(metadata?.companyName || ''), lm + 2, y + 5, { maxWidth: tableW - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 106, 138);
  const addr = [metadata?.companyAdd1, metadata?.companyAdd2].filter(Boolean).join(', ');
  if (addr) doc.text(addr, lm + 2, y + 9, { maxWidth: tableW - 4 });
  if (metadata?.companyGst) doc.text(`GST: ${metadata.companyGst}`, lm + 2, y + 12.5, { maxWidth: tableW - 4 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  const accLine = [metadata?.accountName, metadata?.accountCode ? `(${metadata.accountCode})` : '']
    .filter(Boolean)
    .join(' ');
  doc.text(accLine, lm + 2, y + 16.5, { maxWidth: tableW - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 106, 138);
  doc.text(`${metadata?.year || ''}   ${metadata?.endDate || ''}`, lm + 2, y + 19.5, { maxWidth: tableW - 4 });
  y += panelH + 2;

  let opening = 0;
  let sumDr = 0;
  let sumCr = 0;
  rows.forEach((row) => {
    const vr = String(row.VR_TYPE ?? row.vr_type ?? '').trim().toUpperCase();
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt) || 0;
    if (vr === 'OP') {
      opening = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal) || 0;
    } else {
      sumDr += dr;
      sumCr += cr;
    }
  });

  const boxW = (tableW - 8) / 3;
  const drawSummaryBox = (bx, label, val, borderRgb, valRgb) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...borderRgb);
    doc.setLineWidth(0.35);
    doc.rect(bx, y, boxW, 9, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 150);
    doc.text(label, bx + 2, y + 3.2);
    doc.setTextColor(...valRgb);
    doc.setFontSize(8.5);
    doc.text(formatAmtPdf(val), bx + 2, y + 7, { maxWidth: boxW - 4 });
  };
  drawSummaryBox(lm, 'OPENING', opening, INDIGO, INDIGO);
  drawSummaryBox(lm + boxW + 4, 'TOTAL CR', sumCr, RED, RED);
  drawSummaryBox(lm + (boxW + 4) * 2, 'TOTAL DR', sumDr, GREEN, GREEN);
  y += 11;

  const drawColHead = () => {
    const headH = 7;
    fillBand(y, headH, NAVY);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    cols.forEach((c, i) => {
      const tx = c.right ? xAt[i] + c.w - 1 : xAt[i] + 1;
      doc.text(c.label, tx, y + 4.6, { align: c.right ? 'right' : 'left', maxWidth: c.w - 2 });
    });
    y += headH + 0.5;
    hline(y);
    y += 0.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...NAVY);
  };

  drawColHead();

  const pageBottom = ph - 12;
  let rowStripe = 0;

  const cellLines = (txt, col, fontSize, fontStyle) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', fontStyle);
    const raw = String(txt ?? '').trim();
    if (!raw) return ['—'];
    return doc.splitTextToSize(raw, Math.max(2, col.w - 2));
  };

  const measureRowHeight = (cells, fontSize, fontStyle) => {
    let maxLines = 1;
    cells.forEach((txt, i) => {
      const lines = cellLines(txt, cols[i], fontSize, fontStyle);
      maxLines = Math.max(maxLines, lines.length);
    });
    return Math.max(MIN_ROW_H, ROW_PAD_TOP + maxLines * LINE_H + 1.2);
  };

  const amountHasValue = (txt) => {
    const s = String(txt ?? '').trim();
    return s && s !== '—' && s !== '-';
  };

  const newPageIfNeeded = (neededH) => {
    if (y + neededH > pageBottom) {
      doc.addPage();
      y = 10;
      drawColHead();
      rowStripe = 0;
    }
  };

  const writeCells = (cells, style = 'normal') => {
    const isGrand = style === 'grand';
    const fontSize = isGrand ? 7.5 : 6.5;
    const fontStyle = style === 'normal' ? 'normal' : 'bold';
    const rowH = measureRowHeight(cells, fontSize, fontStyle);

    newPageIfNeeded(rowH + ROW_GAP);
    const rowTop = y;

    if (style === 'stripe') {
      fillBand(rowTop, rowH, rowStripe % 2 === 0 ? [255, 255, 255] : STRIPE);
      rowStripe += 1;
    } else if (isGrand) {
      fillBand(rowTop, rowH, NAVY);
    }

    cells.forEach((txt, i) => {
      const c = cols[i];
      const lines = cellLines(txt, c, fontSize, fontStyle);
      const tx = c.right ? xAt[i] + c.w - 1 : xAt[i] + 1;

      if (isGrand) doc.setTextColor(255, 255, 255);
      else if (c.credit && amountHasValue(txt)) doc.setTextColor(...RED);
      else if (c.debit && amountHasValue(txt)) doc.setTextColor(...GREEN);
      else doc.setTextColor(...NAVY);

      doc.setFont('helvetica', fontStyle);
      doc.setFontSize(fontSize);

      let lineY = rowTop + ROW_PAD_TOP + LINE_H - 0.5;
      lines.forEach((line) => {
        doc.text(line, tx, lineY, { align: c.right ? 'right' : 'left' });
        lineY += LINE_H;
      });
    });

    y = rowTop + rowH + ROW_GAP;
    if (isGrand) {
      hline(y, ACCENT);
      y += 0.5;
    }
  };

  let gDr = 0;
  let gCr = 0;

  rows.forEach((row) => {
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt) || 0;
    gDr += dr;
    gCr += cr;
    writeCells(
      [
        formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date),
        formatLedgerDateDisplay(row.V_DATE ?? row.v_date) || '—',
        String(row.VR_NO ?? row.vr_no ?? '—'),
        String(row.VR_TYPE ?? row.vr_type ?? ''),
        String(row.TYPE ?? row.type ?? '—'),
        String(row.DETAIL ?? row.detail ?? ''),
        formatAmtPdf(dr),
        formatAmtPdf(cr),
        formatAmtPdf(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal),
      ],
      'stripe'
    );
  });

  const last = rows[rows.length - 1];
  const closing = last
    ? parseFloat(last.CL_BALANCE ?? last.cl_balance ?? last.RUN_BAL ?? last.run_bal) || 0
    : 0;

  writeCells(
    ['', '', '', '', '', 'GRAND TOTAL', formatAmtPdf(gDr), formatAmtPdf(gCr), formatAmtPdf(closing)],
    'grand'
  );

  if (!pdfOpts.deferPageNumbers) {
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p += 1) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(120, 130, 150);
      doc.text(`Page ${p} of ${pageCount}`, pw - lm, ph - 5, { align: 'right' });
    }
  }

  if (pdfOpts.returnDoc) return doc;
  return doc.output('blob');
}

export function assertLedgerPdfBlob(blob) {
  if (!blob || blob.size < 4000) {
    throw new Error('PDF could not be generated on this device. Try again or use Excel export.');
  }
}
