/**
 * Voucher module books — VFP BOOKS.PRG (CASHBK, JOUBK, DAYBOOK, BANKSTMT, BANKREC).
 */

'use strict';

const { inferColumnsFromRows } = require('./incomeTaxReports.cjs');

const REPORT_IDS = [
  'cash-book',
  'bank-book',
  'journal-book',
  'cash-book-sum',
  'bank-book-sum',
  'journal-book-sum',
  'day-book',
  'bank-statement',
  'bank-reconc',
];

const CASH_SCHEDULE_KEY = 910;
const BANK_SCHEDULE_KEY = 920;

function parseDdMmYyyy(s) {
  const parts = String(s ?? '').trim().split('-');
  if (parts.length !== 3) return null;
  const dd = Number(parts[0]);
  const mm = Number(parts[1]);
  const yyyy = Number(parts[2]);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd);
}

function toDay(d) {
  if (!d) return null;
  if (d instanceof Date) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return parseDdMmYyyy(d);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[String(k).toUpperCase()] = v;
  }
  return out;
}

function normalizeRows(rows) {
  return (rows || []).map(normalizeRow);
}

function normalizeParams(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = p[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
  const pickNum = (...keys) => {
    const raw = pick(...keys);
    if (!raw) return 0;
    const n = Number(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const yn = (key, def = 'Y') => {
    const v = pick(key).toUpperCase();
    if (!v) return def;
    return v === 'Y' || v === '1' || v === 'T' ? 'Y' : 'N';
  };
  // day-book voucher type toggles (VFP DAYBOOK form defaults)
  return {
    s_date: pick('s_date', 'sdt', 'SDT', 'S_DATE'),
    e_date: pick('e_date', 'edt', 'EDT', 'E_DATE'),
    mcode: pick('mcode', 'party_code', 'MCODE', 'CODE').toUpperCase(),
    comp_year: pickNum('comp_year', 'compYear', 'COMP_YEAR') || null,
    enttype: (pick('enttype', 'ENTTYPE') || 'A').toUpperCase(),
    cvyn: yn('cvyn', 'Y'),
    bvyn: yn('bvyn', 'Y'),
    jvyn: yn('jvyn', 'Y'),
    slyn: yn('slyn', 'N'),
    puyn: yn('puyn', 'N'),
    svyn: yn('svyn', 'N'),
    tvyn: yn('tvyn', 'N'),
    biyn: yn('biyn', 'N'),
    piyn: yn('piyn', 'N'),
    rptformat: pickNum('rptformat', 'RPTFORMAT') || 1,
    fy_s_date: pick('fy_s_date', 'fySDate', 'FY_S_DATE'),
  };
}

function appendGrandTotal(rows, sumKeys, labelKey = 'NAME', labelValue = 'GRAND TOTAL') {
  const list = [...(rows || [])];
  if (!list.length) return list;
  const totals = { [labelKey]: labelValue, _GRAND_TOTAL: true };
  for (const key of sumKeys) totals[key] = 0;
  for (const row of list) {
    if (row._GRAND_TOTAL) continue;
    for (const key of sumKeys) totals[key] += num(row[key]);
  }
  list.push(totals);
  return list;
}

function addRunBal(rows) {
  let bal = 0;
  return rows.map((row) => {
    if (row._GRAND_TOTAL) return row;
    bal += num(row.DR_AMT) - num(row.CR_AMT);
    return { ...row, RUN_BAL: bal };
  });
}

function sortByDateNo(rows, dateKey = 'VR_DATE', noKey = 'VR_NO', trnKey = 'TRN_NO') {
  return [...rows].sort((a, b) => {
    const da = a[dateKey] ? new Date(a[dateKey]).getTime() : 0;
    const db = b[dateKey] ? new Date(b[dateKey]).getTime() : 0;
    if (da !== db) return da - db;
    const na = num(a[noKey]);
    const nb = num(b[noKey]);
    if (na !== nb) return na - nb;
    return num(a[trnKey]) - num(b[trnKey]);
  });
}

function openingRow(sDate, opBal, label = 'OPENING BALANCE') {
  if (!opBal) return null;
  return {
    CODE: '',
    NAME: label,
    CITY: '',
    VR_DATE: sDate,
    VR_NO: 0,
    TRN_NO: 0,
    DR_AMT: opBal > 0 ? opBal : 0,
    CR_AMT: opBal < 0 ? Math.abs(opBal) : 0,
    DETAIL: label,
    CHQ_NO: '',
    VR_TYPE: 'OP',
  };
}

function dateKey(d) {
  const day = toDay(d);
  if (!day) return '';
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function dateFromKey(dk) {
  const parts = String(dk || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0]) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** VFP CASHBK_1 — day-wise opening, transactions, day total, closing (next day opening = prev closing). */
function buildDayWiseBookRows(transactions, sDate, initialOpBal, labels = {}) {
  const openLabel = labels.open || 'CASH IN HAND';
  const dayTotalLabel = labels.dayTotal || 'Day Total';
  const dayCloseLabel = labels.dayClose || 'Closing Balance';
  const sKey = dateKey(parseDdMmYyyy(sDate));

  const byDate = new Map();
  for (const tx of transactions || []) {
    const k = dateKey(tx.VR_DATE);
    if (!k) continue;
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(tx);
  }

  const dateKeys = [...byDate.keys()].sort();
  if (!dateKeys.length && initialOpBal === 0) return [];

  if (initialOpBal !== 0 && sKey && !dateKeys.includes(sKey)) {
    dateKeys.unshift(sKey);
  }
  if (!dateKeys.length && sKey) dateKeys.push(sKey);

  let runningClose = initialOpBal;
  const out = [];

  for (const dk of dateKeys.sort()) {
    const txns = sortByDateNo(byDate.get(dk) || []);
    const vrDate = txns[0]?.VR_DATE ?? dateFromKey(dk) ?? parseDdMmYyyy(sDate);
    const dayOpen = runningClose;

    out.push({
      VR_DATE: vrDate,
      VR_NO: '',
      NAME: openLabel,
      CITY: '',
      DETAIL: '',
      BILL_DATE: null,
      BILL_NO: '',
      CHQ_NO: '',
      VR_TYPE: '',
      DR_AMT: dayOpen > 0 ? dayOpen : 0,
      CR_AMT: dayOpen < 0 ? Math.abs(dayOpen) : 0,
      _ROW_KIND: 'cash_open',
    });

    let dayDr = 0;
    let dayCr = 0;
    for (const tx of txns) {
      dayDr += num(tx.DR_AMT);
      dayCr += num(tx.CR_AMT);
      out.push({
        ...tx,
        DETAIL: tx.DETAIL || '',
        CHQ_NO: tx.CHQ_NO || '',
        _ROW_KIND: 'txn',
      });
    }

    out.push({
      VR_DATE: vrDate,
      VR_NO: '',
      NAME: dayTotalLabel,
      CITY: '',
      DETAIL: '',
      BILL_DATE: dayCr > 0 ? dayCr : dayDr > 0 ? dayDr : null,
      BILL_NO: '',
      CHQ_NO: '',
      VR_TYPE: '',
      DR_AMT: dayDr,
      CR_AMT: dayCr,
      _ROW_KIND: 'day_total',
    });

    runningClose = dayOpen + dayDr - dayCr;
    out.push({
      VR_DATE: vrDate,
      VR_NO: '',
      NAME: dayCloseLabel,
      CITY: '',
      DETAIL: '',
      BILL_DATE: null,
      BILL_NO: '',
      CHQ_NO: '',
      VR_TYPE: '',
      DR_AMT: runningClose > 0 ? runningClose : 0,
      CR_AMT: runningClose < 0 ? Math.abs(runningClose) : 0,
      _ROW_KIND: 'day_close',
    });
  }

  return out;
}

function createVoucherBooks(runQuery) {
  const q = async (sql, binds, comp_uid) => normalizeRows(await runQuery(sql, binds, comp_uid));

  async function fetchOpeningBalance(comp_code, comp_uid, mcode, beforeDate) {
    const rows = await q(
      `SELECT SUM(NVL(DR_AMT, 0) - NVL(CR_AMT, 0)) AS OPBAL
       FROM LEDGER
       WHERE COMP_CODE = :comp_code
         AND TRIM(CODE) = :mcode
         AND VR_DATE < TO_DATE(:before_date, 'DD-MM-YYYY')`,
      { comp_code, mcode, before_date: beforeDate },
      comp_uid
    );
    return num(rows[0]?.OPBAL);
  }

  async function validateAccountSchedule(comp_code, comp_uid, mcode, expectedScheduleKey, label) {
    if (!mcode) {
      throw Object.assign(new Error(`${label} account code is required`), { status: 400 });
    }
    const rows = await q(
      `SELECT TRIM(CODE) AS CODE, ROUND(NVL(SCHEDULE, 0), 2) AS SCHEDULE, TRIM(NAME) AS NAME
       FROM MASTER
       WHERE COMP_CODE = :comp_code AND TRIM(CODE) = :mcode`,
      { comp_code, mcode },
      comp_uid
    );
    if (!rows.length) {
      throw Object.assign(new Error(`Invalid ${label} account code`), { status: 400 });
    }
    const schKey = Math.round(num(rows[0].SCHEDULE) * 100);
    if (schKey !== expectedScheduleKey) {
      const schLabel = (expectedScheduleKey / 100).toFixed(2);
      throw Object.assign(new Error(`Account must be a ${label} account (schedule ${schLabel})`), {
        status: 400,
      });
    }
    return rows[0];
  }

  async function runCashBk(comp_code, comp_uid, p, scheduleKey, options = {}) {
    const isCash = scheduleKey === CASH_SCHEDULE_KEY;
    await validateAccountSchedule(
      comp_code,
      comp_uid,
      p.mcode,
      scheduleKey,
      isCash ? 'Cash' : 'Bank'
    );
    const sql = `
      SELECT TRIM(A.DC_CODE) AS CODE,
             TRIM(B.NAME) AS NAME,
             TRIM(B.CITY) AS CITY,
             A.VR_DATE,
             A.VR_NO,
             MAX(A.TRN_NO) AS TRN_NO,
             SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
             SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
             MAX(A.DETAIL) AS DETAIL,
             MAX(A.CHQ_NO) AS CHQ_NO,
             TRIM(A.VR_TYPE) AS VR_TYPE,
             TRIM(A.CODE) AS O_CODE,
             MAX(A.BILL_DATE) AS BILL_DATE,
             MAX(A.BILL_NO) AS BILL_NO
      FROM LEDGER A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.DC_CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.CODE) = :mcode
        AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
      GROUP BY TRIM(A.DC_CODE), B.NAME, B.CITY, A.VR_DATE, A.VR_NO, TRIM(A.VR_TYPE), TRIM(A.CODE)
      ORDER BY A.VR_DATE, A.VR_NO`;
    const detail = await q(sql, { comp_code, mcode: p.mcode, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const opBal = await fetchOpeningBalance(comp_code, comp_uid, p.mcode, p.s_date);

    if (options.dayWise) {
      const rows = buildDayWiseBookRows(detail, p.s_date, opBal, {
        open: isCash ? 'CASH IN HAND' : 'OPENING BALANCE',
        dayTotal: 'Day Total',
        dayClose: 'Closing Balance',
      });
      return { rows, columns: inferColumnsFromRows(rows) };
    }

    const op = openingRow(p.s_date, opBal);
    const rows = addRunBal(appendGrandTotal(sortByDateNo(op ? [op, ...detail] : detail), ['DR_AMT', 'CR_AMT'], 'NAME', 'GRAND TOTAL'));
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runCashSum(comp_code, comp_uid, p, scheduleKey) {
    await validateAccountSchedule(
      comp_code,
      comp_uid,
      p.mcode,
      scheduleKey,
      scheduleKey === CASH_SCHEDULE_KEY ? 'Cash' : 'Bank'
    );
    const allRows = await q(
      `SELECT A.VR_DATE, A.VR_NO, TRIM(A.VR_TYPE) AS VR_TYPE, TRIM(A.TYPE) AS TYPE,
              NVL(A.DR_AMT, 0) AS DR_AMT, NVL(A.CR_AMT, 0) AS CR_AMT
       FROM LEDGER A
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.CODE) = :mcode
         AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
       ORDER BY A.VR_DATE, A.VR_NO`,
      { comp_code, mcode: p.mcode, e_date: p.e_date },
      comp_uid
    );
    const ds = toDay(p.s_date);
    const de = toDay(p.e_date);
    const period = allRows.filter((r) => {
      const d = toDay(r.VR_DATE);
      if (!d || !ds || !de) return false;
      return d >= ds && d <= de;
    });
    let opBal = 0;
    for (const r of allRows) {
      const d = toDay(r.VR_DATE);
      if (d && ds && d < ds) opBal += num(r.DR_AMT) - num(r.CR_AMT);
    }
    const byDate = new Map();
    for (const r of period) {
      const key = r.VR_DATE ? new Date(r.VR_DATE).toISOString().slice(0, 10) : '';
      if (!byDate.has(key)) byDate.set(key, { VR_DATE: r.VR_DATE, DR_AMT: 0, CR_AMT: 0, VR_TYPE: 'CV' });
      const agg = byDate.get(key);
      agg.DR_AMT += num(r.DR_AMT);
      agg.CR_AMT += num(r.CR_AMT);
    }
    const summary = sortByDateNo([...byDate.values()]);
    const op = openingRow(p.s_date, opBal);
    const rows = appendGrandTotal(op ? [op, ...summary] : summary, ['DR_AMT', 'CR_AMT'], 'VR_DATE', 'GRAND TOTAL');
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runJouBk(comp_code, comp_uid, p) {
    const rows = await q(
      `SELECT A.VR_DATE, A.VR_NO, TRIM(B.NAME) AS NAME, TRIM(B.CITY) AS CITY,
              NVL(A.DR_AMT, 0) AS DR_AMT, NVL(A.CR_AMT, 0) AS CR_AMT, TRIM(A.DETAIL) AS DETAIL
       FROM LEDGER A
       INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.VR_TYPE) = 'JV'
         AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
       ORDER BY A.VR_DATE, A.VR_NO`,
      { comp_code, s_date: p.s_date, e_date: p.e_date },
      comp_uid
    );
    return {
      rows: appendGrandTotal(rows, ['DR_AMT', 'CR_AMT'], 'DETAIL', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runJouSum(comp_code, comp_uid, p) {
    const binds = { comp_code, s_date: p.s_date, e_date: p.e_date };
    let compYearSql = '';
    if (p.comp_year) {
      compYearSql = ' AND A.COMP_YEAR = :comp_year';
      binds.comp_year = p.comp_year;
    }
    const rows = await q(
      `SELECT A.VR_DATE, A.VR_NO,
              SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
              SUM(NVL(A.CR_AMT, 0)) AS CR_AMT
       FROM LEDGER A
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.VR_TYPE) = 'JV'
         AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
         ${compYearSql}
       GROUP BY A.VR_DATE, A.VR_NO
       ORDER BY A.VR_DATE, A.VR_NO`,
      binds,
      comp_uid
    );
    return {
      rows: appendGrandTotal(rows, ['DR_AMT', 'CR_AMT'], 'VR_NO', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  function buildVrTypeList(p) {
    const types = [];
    if (p.cvyn === 'Y') types.push('CV');
    if (p.bvyn === 'Y') types.push('BV');
    if (p.biyn === 'Y') types.push('BI');
    if (p.jvyn === 'Y') types.push('JV');
    if (p.slyn === 'Y') types.push('SL', 'CN');
    if (p.puyn === 'Y') types.push('PU', 'DN');
    if (p.svyn === 'Y') types.push('KV');
    if (p.tvyn === 'Y') types.push('TV');
    if (p.piyn === 'Y') types.push('PI');
    return types;
  }

  async function runDayBook(comp_code, comp_uid, p) {
    await validateAccountSchedule(comp_code, comp_uid, p.mcode, CASH_SCHEDULE_KEY, 'Cash');
    const vrTypes = buildVrTypeList(p);
    if (!vrTypes.length) {
      throw Object.assign(new Error('Select at least one voucher type for Day Book'), { status: 400 });
    }
    const typeBinds = {};
    const typePlaceholders = vrTypes.map((t, i) => {
      typeBinds[`vt${i}`] = t;
      return `:vt${i}`;
    });
    const raw = await q(
      `SELECT TRIM(A.CODE) AS CODE,
              TRIM(B.NAME) AS NAME,
              TRIM(B.CITY) AS CITY,
              ROUND(NVL(B.SCHEDULE, 0), 2) AS SCHEDULE,
              A.VR_DATE,
              A.VR_NO,
              NVL(A.TRN_NO, 0) AS TRN_NO,
              NVL(A.DR_AMT, 0) AS DR_AMT,
              NVL(A.CR_AMT, 0) AS CR_AMT,
              TRIM(A.DETAIL) AS DETAIL,
              TRIM(A.CHQ_NO) AS CHQ_NO,
              TRIM(A.VR_TYPE) AS VR_TYPE,
              TRIM(A.DC_CODE) AS DC_CODE,
              NVL(A.QNTY, 0) AS QNTY,
              NVL(A.WEIGHT, 0) AS WEIGHT,
              A.BILL_DATE,
              NVL(A.B_NO, 0) AS B_NO,
              TRIM(A.E_TYPE) AS E_TYPE
       FROM LEDGER A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.CODE) <> :mcode
         AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
         AND TRIM(A.VR_TYPE) IN (${typePlaceholders.join(', ')})
       ORDER BY A.VR_DATE, A.VR_TYPE, A.VR_NO, A.TRN_NO`,
      { comp_code, mcode: p.mcode, s_date: p.s_date, e_date: p.e_date, ...typeBinds },
      comp_uid
    );

    const rows = [];
    if (p.cvyn === 'Y') {
      const opBal = await fetchOpeningBalance(comp_code, comp_uid, p.mcode, p.s_date);
      const op = openingRow(p.s_date, opBal);
      if (op) rows.push(op);
    }

    for (const r of raw) {
      let dr = num(r.DR_AMT);
      let cr = num(r.CR_AMT);
      if (String(r.VR_TYPE).trim() === 'CV') {
        const swap = dr;
        dr = cr;
        cr = swap;
      }
      if (p.rptformat === 2) {
        const sch = num(r.SCHEDULE);
        const vt = String(r.VR_TYPE).trim();
        if (vt === 'SL' && ![8.1, 11.1, 12.1].includes(Math.round(sch * 100) / 100)) continue;
        if (vt === 'PU' && ![11.1, 12.1, 14.1].includes(Math.round(sch * 100) / 100)) continue;
      }
      rows.push({
        ...r,
        DR_AMT: dr,
        CR_AMT: cr,
        DETAIL: r.DETAIL || '',
        CHQ_NO: r.CHQ_NO || '',
      });
    }

  const sorted = sortByDateNo(rows, 'VR_DATE', 'VR_NO', 'TRN_NO');
    return {
      rows: appendGrandTotal(sorted, ['DR_AMT', 'CR_AMT'], 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(sorted),
    };
  }

  async function runBankStmt(comp_code, comp_uid, p) {
    const acct = await validateAccountSchedule(comp_code, comp_uid, p.mcode, BANK_SCHEDULE, 'Bank');
    const opBal = await fetchOpeningBalance(comp_code, comp_uid, p.mcode, p.s_date);
    const detail = await q(
      `SELECT A.VR_DATE,
              TRIM(A.VR_TYPE) AS VR_TYPE,
              A.VR_NO,
              TRIM(A.CHQ_NO) AS CHQ_NO,
              SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
              SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
              MAX(A.V_DATE) AS BANK_DATE,
              MAX(A.DETAIL) AS DETAIL,
              TRIM(A.DC_CODE) AS DC_CODE
       FROM LEDGER A
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.CODE) = :mcode
         AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
       GROUP BY A.VR_DATE, A.VR_TYPE, A.VR_NO, A.CHQ_NO, A.DC_CODE
       ORDER BY A.VR_DATE, A.VR_TYPE, A.VR_NO, A.CHQ_NO`,
      { comp_code, mcode: p.mcode, s_date: p.s_date, e_date: p.e_date },
      comp_uid
    );

    const rows = [];
    if (opBal) {
      rows.push({
        CODE: p.mcode,
        NAME: acct.NAME,
        VR_DATE: p.s_date,
        VR_TYPE: 'OP',
        VR_NO: 0,
        CHQ_NO: '',
        DR_AMT: opBal > 0 ? opBal : 0,
        CR_AMT: opBal < 0 ? Math.abs(opBal) : 0,
        DETAIL: 'OPENING',
        BANK_DATE: null,
      });
    }
    for (const r of detail) {
      let detailText = r.DETAIL || '';
      if (num(r.DR_AMT) !== 0 && String(r.VR_TYPE).trim() === 'CV') {
        detailText = 'CASH DEPOSITED';
      }
      rows.push({
        CODE: p.mcode,
        NAME: acct.NAME,
        VR_DATE: r.VR_DATE,
        VR_TYPE: r.VR_TYPE,
        VR_NO: r.VR_NO,
        CHQ_NO: r.CHQ_NO || '',
        DR_AMT: num(r.DR_AMT),
        CR_AMT: num(r.CR_AMT),
        DETAIL: detailText,
        BANK_DATE: r.BANK_DATE,
      });
    }
    const withBal = addRunBal(rows);
    return {
      rows: appendGrandTotal(withBal, ['DR_AMT', 'CR_AMT'], 'DETAIL', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(withBal),
    };
  }

  function isCleared(clDate, edt) {
    const d = toDay(clDate);
    const e = toDay(edt);
    if (!d || !e) return false;
    return d <= e;
  }

  function isEmptyDate(v) {
    if (v == null || v === '') return true;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) || d.getFullYear() < 1901;
  }

  async function runBankReconc(comp_code, comp_uid, p) {
    await validateAccountSchedule(comp_code, comp_uid, p.mcode, BANK_SCHEDULE_KEY, 'Bank');
    const fyStart = p.fy_s_date || p.s_date;

    const opRows = await q(
      `SELECT SUM(NVL(DR_AMT, 0) - NVL(CR_AMT, 0)) AS OP_BAL
       FROM LEDGER
       WHERE COMP_CODE = :comp_code
         AND TRIM(VR_TYPE) = 'OP'
         AND TRIM(CODE) = :mcode`,
      { comp_code, mcode: p.mcode },
      comp_uid
    );
    let opBal = num(opRows[0]?.OP_BAL);

    const preFy = await q(
      `SELECT SUM(NVL(DR_AMT, 0)) AS DR_AMT, SUM(NVL(CR_AMT, 0)) AS CR_AMT
       FROM BANKSTMT
       WHERE COMP_CODE = :comp_code
         AND TRIM(CODE) = :mcode
         AND VR_DATE < TO_DATE(:fy_s_date, 'DD-MM-YYYY')`,
      { comp_code, mcode: p.mcode, fy_s_date: fyStart },
      comp_uid
    );
    opBal = opBal + num(preFy[0]?.CR_AMT) - num(preFy[0]?.DR_AMT);

    const bankSide = await q(
      `SELECT TRIM(A.VR_TYPE) AS VR_TYPE, A.VR_DATE, A.VR_NO,
              TRIM(A.DC_CODE) AS CODE, TRIM(B.NAME) AS NAME,
              TRIM(A.CHQ_NO) AS CHQ_NO,
              NVL(A.DR_AMT, 0) AS DR_AMT, NVL(A.CR_AMT, 0) AS CR_AMT,
              A.BANK_DATE AS CL_DATE, TRIM(A.DETAIL) AS DETAIL
       FROM BANKSTMT A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.DC_CODE) = TRIM(B.CODE)
       WHERE A.COMP_CODE = :comp_code AND TRIM(A.CODE) = :mcode`,
      { comp_code, mcode: p.mcode },
      comp_uid
    );

    const bookSide = await q(
      `SELECT TRIM(A.VR_TYPE) AS VR_TYPE, A.VR_DATE, A.VR_NO,
              TRIM(A.DC_CODE) AS CODE, TRIM(B.NAME) AS NAME,
              TRIM(A.CHQ_NO) AS CHQ_NO,
              NVL(A.DR_AMT, 0) AS CR_AMT, NVL(A.CR_AMT, 0) AS DR_AMT,
              A.BANK_DATE AS CL_DATE, TRIM(A.DETAIL) AS DETAIL
       FROM BANKSTMT A
       LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.DC_CODE) = TRIM(B.CODE)
       WHERE A.COMP_CODE = :comp_code AND TRIM(A.DC_CODE) = :mcode`,
      { comp_code, mcode: p.mcode },
      comp_uid
    );

    const bankRec = [];
    if (opBal) {
      bankRec.push({
        VR_TYPE: 'OP',
        VR_DATE: fyStart,
        CL_DATE: fyStart,
        CODE: p.mcode,
        NAME: 'OPENING BALANCE',
        CHQ_NO: '',
        DR_AMT: opBal > 0 ? opBal : 0,
        CR_AMT: opBal < 0 ? Math.abs(opBal) : 0,
        DETAIL: '',
      });
    }

    const clearedBank = bankSide.filter((r) => !isEmptyDate(r.CL_DATE) && isCleared(r.CL_DATE, p.e_date));
    const clearedBook = bookSide.filter((r) => !isEmptyDate(r.CL_DATE) && isCleared(r.CL_DATE, p.e_date));
    bankRec.push(...clearedBank, ...clearedBook);

    let periodOp = 0;
    for (const r of bankRec) {
      periodOp += num(r.DR_AMT) - num(r.CR_AMT);
    }
    const periodStart = toDay(p.s_date);
    for (const r of bankRec) {
      const cl = toDay(r.CL_DATE);
      if (cl && periodStart && cl < periodStart) periodOp += num(r.DR_AMT) - num(r.CR_AMT);
    }

    const finalRows = [];
    if (periodOp) {
      finalRows.push({
        VR_TYPE: 'OP',
        VR_DATE: p.s_date,
        CL_DATE: p.s_date,
        NAME: 'OPENING BALANCE',
        CHQ_NO: '',
        DR_AMT: periodOp > 0 ? periodOp : 0,
        CR_AMT: periodOp < 0 ? Math.abs(periodOp) : 0,
        DETAIL: '',
        SR_NO: 1,
      });
    }

    const inPeriod = (r) => {
      const cl = toDay(r.CL_DATE);
      return cl && periodStart && cl >= periodStart;
    };

    finalRows.push(
      ...clearedBank.filter(inPeriod),
      ...clearedBook.filter(inPeriod),
      ...bankSide.filter((r) => isEmptyDate(r.CL_DATE) && isCleared(r.VR_DATE, p.e_date)),
      ...bookSide.filter((r) => isEmptyDate(r.CL_DATE) && isCleared(r.VR_DATE, p.e_date))
    );

    const normalized = finalRows.map((r, idx) => ({
      VR_TYPE: r.VR_TYPE || '',
      VR_DATE: r.VR_DATE,
      VR_NO: r.VR_NO || 0,
      CODE: r.CODE || '',
      NAME: r.NAME || '',
      CHQ_NO: r.CHQ_NO || '',
      DR_AMT: num(r.DR_AMT),
      CR_AMT: num(r.CR_AMT),
      CL_DATE: r.CL_DATE,
      DETAIL: r.DETAIL || '',
      SR_NO: r.SR_NO || idx + 1,
    }));

    return {
      rows: appendGrandTotal(sortByDateNo(normalized), ['DR_AMT', 'CR_AMT'], 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(normalized),
    };
  }

  const HANDLERS = {
    'cash-book': (cc, cu, p) => runCashBk(cc, cu, p, CASH_SCHEDULE_KEY, { dayWise: true }),
    'bank-book': (cc, cu, p) => runCashBk(cc, cu, p, BANK_SCHEDULE_KEY, { dayWise: true }),
    'cash-book-sum': (cc, cu, p) => runCashSum(cc, cu, p, CASH_SCHEDULE_KEY),
    'bank-book-sum': (cc, cu, p) => runCashSum(cc, cu, p, BANK_SCHEDULE_KEY),
    'journal-book': runJouBk,
    'journal-book-sum': runJouSum,
    'day-book': runDayBook,
    'bank-statement': runBankStmt,
    'bank-reconc': runBankReconc,
  };

  async function buildVoucherBook(reportId, comp_code, comp_uid, params = {}, options = {}) {
    const id = String(reportId || '').trim().toLowerCase();
    const handler = HANDLERS[id];
    if (!handler) {
      throw Object.assign(new Error(`Unknown voucher book report id: "${reportId}"`), { status: 400 });
    }
    const cc = String(comp_code ?? '').trim();
    if (!cc) throw Object.assign(new Error('comp_code is required'), { status: 400 });
    if (comp_uid == null) throw Object.assign(new Error('comp_uid is required'), { status: 400 });
    const p = normalizeParams(params);
    if (!p.s_date || !p.e_date) {
      throw Object.assign(new Error('s_date and e_date are required (DD-MM-YYYY)'), { status: 400 });
    }
    if (options.fy_s_date) p.fy_s_date = options.fy_s_date;
    const result = await handler(cc, comp_uid, p);
    const rows = result.rows ?? [];
    const columns = result.columns ?? inferColumnsFromRows(rows);
    return { rows, columns };
  }

  return { buildVoucherBook };
}

module.exports = {
  createVoucherBooks,
  REPORT_IDS,
};
