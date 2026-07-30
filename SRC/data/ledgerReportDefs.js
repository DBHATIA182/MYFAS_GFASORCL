/**
 * Ledger module report UI definitions.
 * SQL/logic: server/ledgerReports.cjs
 */

import { humanizeColumnKey } from './incomeTaxReportDefs';

const numCol = (key, label, decimals = 2) => ({ key, label, type: 'num', decimals });
const txtCol = (key, label) => ({ key, label, type: 'text' });
const dateCol = (key, label) => ({ key, label, type: 'date' });

export const LEDGER_REPORT_FILTER_LABELS = {
  sdt: 'Starting Date (Dr)',
  edt: 'Ending Date (Dr)',
  csdt: 'Starting Date (Cr)',
  cedt: 'Ending Date (Cr)',
  mcode: 'Account Code',
};

/** @type {Record<string, object>} */
export const LEDGER_REPORT_DEFS = {
  'ledger-dr-cr-date': {
    filters: ['mcode', 'sdt', 'edt', 'csdt', 'cedt'],
    ledgerDrCrDateEntry: true,
    compactEntry: true,
    ledgerDrilldown: true,
    compactTable: true,
    grandTotalKeys: ['DR_AMT', 'CR_AMT'],
    grandTotalLabelKey: 'DETAIL',
    filterOverrides: {
      mcode: {
        label: 'Account Code',
        required: true,
        pickList: 'masterAccount',
        manualCode: true,
        hint: 'Required — tap ? / F1 to search account by code or name.',
      },
      sdt: { label: 'Starting Date (Dr)', required: true },
      edt: { label: 'Ending Date (Dr)', required: true },
      csdt: { label: 'Starting Date (Cr)', required: true },
      cedt: { label: 'Ending Date (Cr)', required: true },
    },
    displayColumns: [
      dateCol('VR_DATE', 'Date'),
      txtCol('VR_NO', 'No'),
      txtCol('VR_TYPE', 'Type'),
      txtCol('DETAIL', 'Detail'),
      txtCol('CHQ_NO', 'Chq No'),
      numCol('DR_AMT', 'Debit'),
      numCol('CR_AMT', 'Credit'),
    ],
  },
};

export function getLedgerReportDef(reportId) {
  const id = String(reportId || '').trim().toLowerCase();
  return LEDGER_REPORT_DEFS[id] || { filters: ['sdt', 'edt', 'mcode'] };
}

export function resolveLedgerReportFilterMeta(reportId, filterKey) {
  const def = getLedgerReportDef(reportId);
  const override = def?.filterOverrides?.[filterKey] || {};
  return {
    label: override.label || LEDGER_REPORT_FILTER_LABELS[filterKey] || humanizeColumnKey(filterKey),
    hint: override.hint,
    pickList: override.pickList || null,
    manualCode: override.manualCode === true,
    defaultValue: override.defaultValue != null ? String(override.defaultValue).trim() : '',
    required: override.required === true,
  };
}

export function resolveLedgerReportDisplayColumns(reportId, apiColumns, rows) {
  const def = getLedgerReportDef(reportId);
  if (def.displayColumns?.length) return def.displayColumns;
  if (apiColumns?.length) return apiColumns;
  const sample = rows?.[0];
  if (!sample) return [];
  return Object.keys(sample)
    .filter((k) => !k.startsWith('_'))
    .map((key) => ({
      key,
      label: humanizeColumnKey(key),
      type: /amt|amount|bal|dr|cr/i.test(key) ? 'num' : /date/i.test(key) ? 'date' : 'text',
    }));
}
