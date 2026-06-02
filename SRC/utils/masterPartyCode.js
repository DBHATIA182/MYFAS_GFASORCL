/** VFP9 master form: schedule must be non-zero with a fractional part (e.g. 8.10, not 8). */
export function isValidMasterScheduleNo(schedule) {
  const n = Number(schedule);
  if (!Number.isFinite(n) || n === 0) return false;
  const frac = Math.abs(n - Math.trunc(n));
  return frac > 1e-9;
}

/** Next code: 1-char RANGE prefix + 5-digit suffix (VARCHAR2(6)). */
export function nextMasterCodeFromLast(lastCode, rangePrefix) {
  const prefix = String(rangePrefix ?? '')
    .trim()
    .toUpperCase()
    .charAt(0);
  if (!prefix) return '';
  const mcode = String(lastCode ?? '')
    .trim()
    .toUpperCase();
  if (!mcode) return `${prefix}00001`;
  const suffix = mcode.length >= 6 ? mcode.slice(1, 6) : mcode.slice(1);
  const num = (parseInt(suffix.replace(/\D/g, ''), 10) || 0) + 1;
  if (num > 99999) return '';
  return `${prefix}${String(num).padStart(5, '0')}`;
}

export function normalizeMasterPartyCode(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 6);
}

export function isValidMasterPartyCode(code) {
  const c = normalizeMasterPartyCode(code);
  return /^[A-Z][0-9]{5}$/.test(c);
}
