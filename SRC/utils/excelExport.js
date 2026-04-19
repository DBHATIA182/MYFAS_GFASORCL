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
export function downloadExcelWorkbook(sheets, baseFilename) {
  const wb = XLSX.utils.book_new();
  const list = Array.isArray(sheets) && sheets.length > 0 ? sheets : [{ name: 'Sheet1', data: [] }];
  for (const { name, data } of list) {
    const rows = Array.isArray(data) ? data : [];
    let ws;
    if (rows.length === 0) {
      ws = XLSX.utils.aoa_to_sheet([['(No rows)']]);
    } else {
      ws = XLSX.utils.json_to_sheet(rows);
    }
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(name));
  }
  const fname = `${sanitizeFilenamePart(baseFilename)}_${stamp()}.xlsx`;
  XLSX.writeFile(wb, fname);
}

/** Single sheet from array of plain objects (API / report rows). */
export function downloadExcelRows(rows, sheetName, baseFilename) {
  downloadExcelWorkbook([{ name: sheetName, data: rows }], baseFilename);
}
