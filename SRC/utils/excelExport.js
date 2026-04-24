import * as XLSX from 'xlsx';

function sanitizeFilenamePart(s) {
  return String(s || 'report')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80);
}

/** Excel sheet name max 31 chars; forbidden : \ / ? * [ ] */
function sanitizeSheetName(s) {
  const t = String(s || 'Sheet').replace(/[:\\/?*[\]]/g, '_').trim() || 'Sheet';
  return t.slice(0, 31);
}

function stamp() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Download .xlsx from one or more object-row datasets.
 * @param {{ name: string, data: object[] }[]} sheets
 * @param {string} baseFilename without extension (e.g. company + report id)
 */
export function downloadExcelWorkbook(sheets, baseFilename, options = {}) {
  const wb = XLSX.utils.book_new();
  const list = Array.isArray(sheets) && sheets.length > 0 ? sheets : [{ name: 'Sheet1', data: [] }];
  const startRow = Math.max(1, Number(options?.startRow) || 1);
  const includeHeaders = options?.includeHeaders !== false;
  const sheetTitles = options?.sheetTitles || {};
  const sheetHeaderRows = options?.sheetHeaderRows || {};
  const emptySheetHeaders = options?.emptySheetHeaders || {};
  const originCell = `A${startRow}`;
  const emptyPrefix = Array.from({ length: Math.max(0, startRow - 1) }, () => []);
  for (const { name, data } of list) {
    const rows = Array.isArray(data) ? data : [];
    let ws;
    if (rows.length === 0) {
      ws = XLSX.utils.aoa_to_sheet(emptyPrefix);
      const headers = Array.isArray(emptySheetHeaders?.[name]) ? emptySheetHeaders[name] : [];
      if (includeHeaders && headers.length > 0) {
        XLSX.utils.sheet_add_aoa(ws, [headers], { origin: originCell });
      }
    } else {
      ws = XLSX.utils.aoa_to_sheet(emptyPrefix);
      XLSX.utils.sheet_add_json(ws, rows, { origin: originCell, skipHeader: !includeHeaders });
    }
    const title = String(sheetTitles?.[name] ?? '').trim();
    if (title) {
      XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: 'A1' });
    }
    const headerRows = Array.isArray(sheetHeaderRows?.[name]) ? sheetHeaderRows[name] : [];
    headerRows.forEach((h) => {
      if (!h || !h.origin || !Array.isArray(h.values)) return;
      XLSX.utils.sheet_add_aoa(ws, h.values, { origin: h.origin });
    });
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(name));
  }
  const fname = `${sanitizeFilenamePart(baseFilename)}_${stamp()}.xlsx`;
  XLSX.writeFile(wb, fname);
}

/** Single sheet from array of plain objects (API / report rows). */
export function downloadExcelRows(rows, sheetName, baseFilename) {
  downloadExcelWorkbook([{ name: sheetName, data: rows }], baseFilename);
}
