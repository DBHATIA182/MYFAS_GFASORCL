import { rowFieldAny } from './rowFieldCI';

/** MASTER.CODE — VARCHAR2 (e.g. O06004), never coerce to number. */
export function ledgerAccountCode(row) {
  return String(rowFieldAny(row, ['CODE', 'code']) || '').trim();
}

export function normalizeLedgerAccountCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

export function ledgerAccountCodesEqual(a, b) {
  const left = normalizeLedgerAccountCode(a);
  const right = normalizeLedgerAccountCode(b);
  return left !== '' && left === right;
}

export function findAccountByCode(accounts, code) {
  const target = normalizeLedgerAccountCode(code);
  if (!target) return undefined;
  return (accounts || []).find((a) => ledgerAccountCodesEqual(ledgerAccountCode(a), target));
}
