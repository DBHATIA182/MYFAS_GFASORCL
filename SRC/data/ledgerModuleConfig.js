/**
 * Ledger module reports (moved from Other Reports) — VFP MYLEGER, etc.
 */

/** Live ledger report screen — Slide 96 (Dr/Cr date etc.; classic party ledger stays Slide 5). */
export const LEDGER_REPORT_SLIDE = 96;

/** reportMenuConfig section id — restore when leaving a ledger module report. */
export const LEDGER_MENU_MODULE_ID = 'ledger-reports';

/** @type {Array<{ id: string, title: string, shortTitle: string, description: string, vfpCommand?: string, vfpNote?: string }>} */
export const LEDGER_MODULE_ITEMS = [
  {
    id: 'ledger-dr-cr-date',
    title: 'Ledger Dr/Cr Date',
    shortTitle: 'Ledger Dr/Cr',
    description: 'Ledger with separate debit and credit date ranges',
    vfpCommand: "DO OTHER_RPT WITH 'X'",
    vfpNote: 'DO FORM MYLEGER WITH 1',
  },
];

const LEDGER_BY_ID = Object.fromEntries(LEDGER_MODULE_ITEMS.map((m) => [m.id, m]));

export function findLedgerModuleItem(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return LEDGER_BY_ID[id] || null;
}

export function isLedgerModuleReport(reportId) {
  return Boolean(findLedgerModuleItem(reportId));
}

export function resolveLedgerReportSlideNo(reportType) {
  return findLedgerModuleItem(reportType) ? LEDGER_REPORT_SLIDE : null;
}
