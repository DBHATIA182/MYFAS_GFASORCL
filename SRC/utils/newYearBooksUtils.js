import { toInputDateString } from './dateFormat';

function localYmd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** VFP: XYEAR = STR(YEAR(E_DATE),4); DNAME = 'GRAIN'+XYEAR; N_YEAR = XYEAR */
export function deriveFromEndingDate(endDateYmd, directoryPrefix = 'GRAIN') {
  if (!endDateYmd) return { newYear: '', directoryName: '', compUid: '' };
  const d = new Date(toInputDateString(endDateYmd));
  if (Number.isNaN(d.getTime())) return { newYear: '', directoryName: '', compUid: '' };
  const xYear = String(d.getFullYear());
  const prefix = String(directoryPrefix || 'GRAIN').trim().toUpperCase();
  const directoryName = `${prefix}${xYear}`;
  return { newYear: xYear, directoryName, compUid: directoryName };
}

/** Next Indian FY start/end from current compdet end date (day after end → +1 year − 1 day). */
export function suggestNextFinancialYear(compEndRaw, directoryPrefix = 'GRAIN') {
  const end = compEndRaw ? new Date(toInputDateString(compEndRaw)) : null;
  if (!end || Number.isNaN(end.getTime())) {
    return { startDate: '', endDate: '', newYear: '', directoryName: '', compUid: '' };
  }
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const endNew = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  const endYmd = localYmd(endNew);
  const derived = deriveFromEndingDate(endYmd, directoryPrefix);
  return {
    startDate: localYmd(start),
    endDate: endYmd,
    newYear: derived.newYear,
    directoryName: derived.directoryName,
    compUid: derived.compUid,
  };
}
