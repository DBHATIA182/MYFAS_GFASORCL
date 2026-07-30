/**
 * Income tax reports — ported from VFP prg/itaxrpt.prg and related procedures.
 * Factory: createIncomeTaxReports(runQuery) → { buildIncomeTaxReport }
 */

'use strict';

const FISCAL_MONTHS = [
  { key: 'APR', mth: 4 },
  { key: 'MAY', mth: 5 },
  { key: 'JUNE', mth: 6 },
  { key: 'JULY', mth: 7 },
  { key: 'AUGUST', mth: 8 },
  { key: 'SEP', mth: 9 },
  { key: 'OCTOBER', mth: 10 },
  { key: 'NOV', mth: 11 },
  { key: 'DEC', mth: 12 },
  { key: 'JAN', mth: 1 },
  { key: 'FEB', mth: 2 },
  { key: 'MAR', mth: 3 },
];

const REPORT_IDS = [
  'loaner-list',
  'broker-list',
  'party-wise-purchase',
  'party-wise-sales',
  'top-party-sales',
  'month-schedule-wise-list',
  'customer-arhat',
  'dami-wise-sales',
  'monthly-purchase-report',
  'monthly-sales-report',
  'item-wise-purchase-sale',
  'item-wise-sales-dami',
  'party-wise-purchase-bill',
  'party-wise-sale-bill',
  'party-wise-purchase-item',
  'party-wise-sale-item',
  'item-wise-sales-party',
  'party-wise-sale-month',
  'item-wise-sale-month-party',
  'supplier-sales-customer-wise',
  'lot-wise-purchase-sale',
  'item-wise-purchase',
  'item-wise-purchase-monthly',
  'party-wise-sale-tdg-consg',
  'sale-above-amount',
  'sale-detail-excel',
  'item-wise-sales-detail',
  'ledger-dccode-report',
  'purchase-detail-excel',
  'cash-movement-monthly',
  'monthly-cash-noncash-exp',
  'customer-bill-payment-detail',
  'customer-bill-payment-summary',
  'broker-station-wise-sales',
  'supplier-bill-payment-detail',
];

/** @param {unknown} v */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** @param {Record<string, unknown>} row */
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[String(k).toUpperCase()] = v;
  }
  return out;
}

/** @param {unknown[]} rows */
function normalizeRows(rows) {
  return (rows || []).map(normalizeRow);
}

/** @param {Record<string, unknown>} params */
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
  return {
    s_date: pick('s_date', 'sdt', 'SDT', 'S_DATE'),
    e_date: pick('e_date', 'edt', 'EDT', 'E_DATE'),
    min_amt: pickNum('min_amt', 'minAmt', 'MINAMT', 'MIN_AMT'),
    top_n: pickNum('top_n', 'topN', 'TOP_N', 'TOPN'),
    schedule_no: pickNum('schedule_no', 'scheduleNo', 'schno', 'SCHNO', 'SCH_NO'),
    state_code: pick('state_code', 'stateCode', 'STATE_CODE'),
    scode: pick('scode', 'mcode_party', 'MCODE', 'CODE'),
    icode: pickNum('icode', 'item_code', 'ITEM_CODE'),
    bk_code: pick('bk_code', 'bkCode', 'BK_CODE'),
    bk_name: pick('bk_name', 'bkName', 'BK_NAME'),
    mdc: pick('mdc', 'MDC').toUpperCase(),
    god_code: pick('god_code', 'godCode', 'GOD_CODE'),
    mcode: pick('mcode', 'cash_code', 'MCODE'),
    mru: pick('mru', 'MRU').toUpperCase(),
    b_no: pickNum('b_no', 'bNo', 'B_NO'),
    pan_yn: pick('pan_yn', 'panYn', 'PAN_YN').toUpperCase(),
    sp_no: pickNum('sp_no', 'spNo', 'SP_NO'),
    exp_type: pick('exp_type', 'expType', 'EXP_TYPE').toLowerCase(),
    detail_mode: pick('detail_mode', 'detailMode', 'DETAIL_MODE').toLowerCase(),
    month_key: pick('month_key', 'monthKey', 'MONTH_KEY').toUpperCase(),
    comp_year: pickNum('comp_year', 'compYear', 'COMP_YEAR') || null,
    self_dalal_code: pick('self_dalal_code', 'selfDalalCode', 'G_SELF_DALAL_CODE'),
    stk_tdg_wgt_type: pick('stk_tdg_wgt_type', 'g_stk_tdg_wgt_type', 'G_STK_TDG_WGT_TYPE'),
    wgt_kq: pick('wgt_kq', 'g_wgtkq', 'G_WGTKQ').toUpperCase(),
    g_sdate: pick('g_sdate', 'gSdate', 'G_SDATE'),
  };
}

function betweenDatesSql(col = 'A.VR_DATE') {
  return `${col} BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')`;
}

function billBetweenDatesSql(col = 'A.BILL_DATE') {
  return `${col} BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')`;
}

function appendGrandTotalRow(rows, { labelKey, labelValue, sumKeys }) {
  if (!rows.length) return rows;
  const total = { [labelKey]: labelValue, _isGrandTotal: true };
  for (const k of sumKeys) {
    total[k] = rows.reduce((s, r) => s + num(r[k]), 0);
  }
  return [...rows, total];
}

function computeLotBillGroupTotals(groupRows) {
  const sumKey = (k) => groupRows.reduce((s, r) => s + num(r[k]), 0);
  const rQty = sumKey('R_QNTY');
  const sQty = sumKey('S_QNTY');
  const rWgt = sumKey('R_WEIGHT');
  const sWgt = sumKey('S_WEIGHT');
  const balQty = rQty - sQty;
  const balWgt = rWgt - sWgt;
  const rAmt = groupRows.reduce((s, r) => s + (num(r.R_QNTY) > 0 ? num(r.AMOUNT) : 0), 0);
  const avgRate = rQty > 0 ? rAmt / rQty : 0;
  const balAmount = balWgt * avgRate;
  return { BAL_QTY: balQty, BAL_WGT: balWgt, AVG_RATE: avgRate, BAL_AMOUNT: balAmount, RATE: '' };
}

function appendLotBillGrandTotalRow(rows, { labelKey, labelValue, sumKeys }) {
  if (!rows.length) return rows;
  const total = { [labelKey]: labelValue, _isGrandTotal: true };
  for (const k of sumKeys) {
    total[k] = rows.reduce((s, r) => s + num(r[k]), 0);
  }
  Object.assign(total, computeLotBillGroupTotals(rows));
  return [...rows, total];
}

function formatCmthYear(cmth, yr) {
  const mon = String(cmth ?? '').trim().toUpperCase();
  const y2 = String(yr ?? '').trim();
  if (!mon) return '';
  const year = y2.length === 4 ? y2 : y2.length === 2 ? `20${y2}` : y2;
  return `${mon}-${year}`;
}

function mapMonthlySummaryRows(rows, { monthKey = 'CMTH', sumKeys }) {
  const mapped = rows.map((raw) => {
    const row = normalizeRow(raw);
    return {
      ...row,
      [monthKey]: formatCmthYear(row.CMTH, row.YR),
    };
  });
  return appendGrandTotalRow(mapped, {
    labelKey: monthKey,
    labelValue: 'GRAND TOTAL',
    sumKeys,
  });
}

function rDateBetweenSql(col = 'A.R_DATE') {
  return `${col} BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')`;
}

/** Infer column metadata from first data row. */
function inferColumnsFromRows(rows, overrides = {}) {
  const first = rows?.[0];
  if (!first) return [];
  return Object.keys(first).map((key) => {
    const o = overrides[key] || {};
    const sample = first[key];
    let type = o.type || 'text';
    if (!o.type) {
      if (sample instanceof Date) type = 'date';
      else if (typeof sample === 'number') type = 'num';
      else if (/DATE$/i.test(key) || key === 'R_DATE' || key === 'BILL_DATE' || key === 'VR_DATE') type = 'date';
      else if (/AMT|AMOUNT|BAL|QTY|QNTY|WEIGHT|WGT|RATE|TDS|INT|EXP|SALE|PUR|COMM|BROK|PAP|DANE|TOT|OP|DR|CR/i.test(key)) {
        type = 'num';
      }
    }
    return {
      key,
      label: o.label || humanizeColumnKey(key),
      type,
    };
  });
}

function humanizeColumnKey(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cols(keys, types = {}) {
  return keys.map((key) => ({
    key,
    label: humanizeColumnKey(key),
    type: types[key] || (/DATE/i.test(key) ? 'date' : /AMT|AMOUNT|BAL|QTY|QNTY|WEIGHT|WGT|RATE|TDS|INT|TOT|OP|DR|CR|NUM/i.test(key) ? 'num' : 'text'),
  }));
}

/** @param {number} scheduleRaw */
function scheduleFilter(scheduleRaw) {
  const schNo = Number(String(scheduleRaw ?? '0').trim().replace(',', '.'));
  return Number.isFinite(schNo) && schNo !== 0 ? schNo : 0;
}

/** ITAXSCH / EXPENSES_MONTHLY month pivot (Indian FY: Apr–Mar). */
function pivotFiscalMonths(detailRows, opts = {}) {
  const {
    groupKeys = ['CODE', 'NAME'],
    amountKey = 'MTH_AMT',
    mthKey = 'MTH',
    yearKey = 'MYEAR',
    endYear = new Date().getFullYear(),
    carryFields = [],
    includeOp = true,
  } = opts;

  const map = new Map();
  for (const raw of detailRows) {
    const r = normalizeRow(raw);
    const gk = groupKeys.map((k) => String(r[k] ?? '')).join('\0');
    if (!map.has(gk)) {
      const base = { OP: 0, TOT: 0 };
      for (const k of groupKeys) base[k] = r[k];
      for (const k of carryFields) base[k] = r[k];
      for (const m of FISCAL_MONTHS) base[m.key] = 0;
      map.set(gk, base);
    }
    const row = map.get(gk);
    const mth = num(r[mthKey]);
    const myear = num(r[yearKey]);
    const amt = num(r[amountKey]);
    const fm = FISCAL_MONTHS.find((x) => x.mth === mth);
    if (!fm) continue;
    if (includeOp && mth === 3 && myear !== endYear) {
      row.OP = num(row.OP) + amt;
    } else {
      row[fm.key] = num(row[fm.key]) + amt;
    }
    row.TOT = num(row.TOT) + amt;
  }
  return [...map.values()];
}

function parseDmyDateParts(dmy) {
  const parts = String(dmy ?? '').trim().split('-');
  if (parts.length !== 3 || parts[2].length !== 4) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  return { day, month, year };
}

/** Map fiscal month column (APR…MAR) to calendar month/year within FY bounds. */
function fiscalMonthCalendar(sDate, eDate, monthKey) {
  const fm = FISCAL_MONTHS.find((m) => m.key === String(monthKey ?? '').trim().toUpperCase());
  if (!fm) return null;
  const start = parseDmyDateParts(sDate);
  const end = parseDmyDateParts(eDate);
  if (!start || !end) return null;
  return { mth: fm.mth, myear: fm.mth >= 4 ? start.year : end.year };
}

function pivotExpensesMonthly(rawRows) {
  const detail = normalizeRows(rawRows).filter((r) => num(r.CASH_EXP) + num(r.NON_CASH_EXP) > 0);
  const heads = [
    { name: 'CASH EXP.', key: 'CASH_EXP' },
    { name: 'NON CASH EXP.', key: 'NON_CASH_EXP' },
  ];
  const out = heads.map((h) => {
    const row = { HEAD_NAME: h.name, TOT: 0 };
    for (const m of FISCAL_MONTHS) row[m.key] = 0;
    for (const d of detail) {
      const mth = num(d.MTH);
      const fm = FISCAL_MONTHS.find((x) => x.mth === mth);
      if (!fm) continue;
      row[fm.key] = num(row[fm.key]) + num(d[h.key]);
      row.TOT = num(row.TOT) + num(d[h.key]);
    }
    return row;
  });
  const total = { HEAD_NAME: 'TOTAL', TOT: 0 };
  for (const m of FISCAL_MONTHS) {
    total[m.key] = out.reduce((s, r) => s + num(r[m.key]), 0);
    total.TOT = num(total.TOT) + num(total[m.key]);
  }
  out.push(total);
  return out;
}

function applyCnSign(type, value) {
  return String(type || '').toUpperCase() === 'CN' ? -num(value) : num(value);
}

function groupSaleCn(rows, groupKeys, sumKeys) {
  const map = new Map();
  for (const raw of rows) {
    const r = normalizeRow(raw);
    const gk = groupKeys.map((k) => String(r[k] ?? '')).join('\0');
    if (!map.has(gk)) {
      const base = {};
      for (const k of groupKeys) base[k] = r[k];
      for (const k of sumKeys) base[k] = 0;
      map.set(gk, base);
    }
    const agg = map.get(gk);
    const type = r.TYPE;
    for (const k of sumKeys) {
      agg[k] = num(agg[k]) + applyCnSign(type, r[k]);
    }
  }
  return [...map.values()];
}

function mapLoanerListRow(r) {
  const row = normalizeRow(r);
  const op = num(row.OP);
  const crAmt = num(row.CR_AMT);
  const crInt = num(row.CR_INT);
  const drAmt = num(row.DR_AMT);
  const drTds = num(row.DR_TDS);
  const totCr = op > 0 ? op - (crAmt + crInt) : Math.abs(op) + crAmt + crInt;
  return {
    CODE: String(row.CODE ?? '').trim(),
    NAME: String(row.NAME ?? '').trim(),
    PAN: String(row.PAN ?? '').trim(),
    SCHEDULE: row.SCHEDULE ?? null,
    ADD1: String(row.ADD1 ?? '').trim(),
    ADD2: String(row.ADD2 ?? '').trim(),
    ADD3: String(row.ADD3 ?? '').trim(),
    CITY: String(row.CITY ?? '').trim(),
    OP: op,
    CR_AMT: crAmt,
    CR_INT: crInt,
    TOT_CR: totCr,
    DR_AMT: drAmt,
    DR_TDS: drTds,
    TOT_DR: drAmt + drTds,
    CL_BAL: num(row.CL_BAL),
  };
}

function createIncomeTaxReports(runQuery) {
  if (typeof runQuery !== 'function') {
    throw new Error('createIncomeTaxReports requires runQuery(sql, binds, schema) function');
  }

  async function q(sql, binds, comp_uid) {
    const raw = await runQuery(sql, binds, comp_uid);
    return normalizeRows(raw);
  }

  async function runLoanerList(comp_code, comp_uid, p) {
    const schedule_no = scheduleFilter(p.schedule_no);
    const sql = `
      WITH X0 AS (
        SELECT
          A.CODE, B.NAME, B.PAN, MAX(B.SCHEDULE) AS SCHEDULE,
          MAX(B.ADD1) AS ADD1, MAX(B.ADD2) AS ADD2, MAX(B.ADD3) AS ADD3, MAX(B.CITY) AS CITY,
          SUM(CASE WHEN A.VR_TYPE = 'OP' THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS OP,
          SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND SUBSTR(NVL(A.DETAIL, 'XXX'), 1, 3) <> 'INT' AND A.VR_TYPE <> 'OP' THEN A.CR_AMT ELSE 0 END) AS CR_AMT,
          SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND SUBSTR(NVL(A.DETAIL, 'XXX'), 1, 3) = 'INT' THEN A.CR_AMT ELSE 0 END) AS CR_INT,
          SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND SUBSTR(NVL(A.DETAIL, 'XXX'), 1, 3) <> 'TDS' AND A.VR_TYPE <> 'OP' THEN A.DR_AMT ELSE 0 END) AS DR_AMT,
          SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND SUBSTR(NVL(A.DETAIL, 'XXX'), 1, 3) = 'TDS' THEN A.DR_AMT ELSE 0 END) AS DR_TDS,
          SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CL_BAL
        FROM LEDGER A
        INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code AND SUBSTR(A.CODE, 1, 1) = 'L'
        GROUP BY A.CODE, B.NAME, B.PAN
      )
      SELECT * FROM X0
      WHERE (:schedule_no = 0 OR SCHEDULE = :schedule_no)
      ORDER BY NAME, CODE`;
    const rows = (await q(sql, { comp_code, schedule_no }, comp_uid)).map(mapLoanerListRow);
    return {
      rows,
      columns: cols([
        'CODE', 'NAME', 'PAN', 'OP', 'CR_AMT', 'CR_INT', 'TOT_CR', 'DR_AMT', 'DR_TDS', 'TOT_DR', 'CL_BAL',
        'ADD1', 'ADD2', 'ADD3', 'CITY',
      ]),
    };
  }

  async function runDalaliRpt(comp_code, comp_uid, p) {
    const schedule_no = scheduleFilter(p.schedule_no);
    if (!schedule_no) throw new Error('broker-list requires schedule_no (VFP DALALIRPT)');
    const sql = `
      SELECT A.CODE, B.NAME, B.PAN, MAX(B.SCHEDULE) AS SCHEDULE,
        MAX(B.ADD1) AS ADD1, MAX(B.ADD2) AS ADD2, MAX(B.ADD3) AS ADD3, MAX(B.CITY) AS CITY,
        SUM(CASE WHEN A.VR_TYPE = 'OP' THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS OP,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 THEN A.CR_AMT ELSE 0 END) AS CR_AMT,
        SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND SUBSTR(NVL(A.DETAIL, 'XXX'), 1, 3) <> 'TDS' THEN A.DR_AMT ELSE 0 END) AS DR_AMT,
        SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND SUBSTR(NVL(A.DETAIL, 'XXX'), 1, 3) = 'TDS' THEN A.DR_AMT ELSE 0 END) AS DR_TDS,
        SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS CL_BAL
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND B.SCHEDULE = :schedule_no
      GROUP BY A.CODE, B.NAME, B.PAN
      ORDER BY CODE, NAME`;
    const rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date, schedule_no }, comp_uid);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runItaxPur(comp_code, comp_uid, p) {
    const min_amt = p.min_amt;
    const sql = `
      WITH Y1 AS (
        SELECT SUP_CODE FROM PURCHASE WHERE COMP_CODE = :comp_code GROUP BY SUP_CODE
      ),
      X0 AS (
        SELECT A.CODE, B.NAME, B.PAN, B.TIN, B.GST_NO, B.ADD1, B.ADD2, B.ADD3, B.CITY, B.OWN_NAME1,
          SUM(CASE WHEN SUBSTR(A.VR_TYPE, 1, 1) = 'P' AND SUBSTR(A.DETAIL, 1, 3) <> 'TDS'
            THEN NVL(A.CR_AMT, 0) - NVL(A.DR_AMT, 0) ELSE 0 END) AS AMOUNT,
          SUM(CASE WHEN SUBSTR(A.VR_TYPE, 1, 1) = 'P' AND SUBSTR(A.DETAIL, 1, 3) = 'TDS'
            THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS TDS_AMOUNT
        FROM LEDGER A
        INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND SUBSTR(A.VR_TYPE, 1, 1) = 'P'
          AND ${betweenDatesSql('A.VR_DATE')}
        GROUP BY A.CODE, B.NAME, B.PAN, B.TIN, B.GST_NO, B.ADD1, B.ADD2, B.ADD3, B.CITY, B.OWN_NAME1
        HAVING SUM(NVL(A.CR_AMT, 0) - NVL(A.DR_AMT, 0)) > :min_amt
      )
      SELECT X0.* FROM X0
      WHERE EXISTS (SELECT 1 FROM Y1 WHERE Y1.SUP_CODE = X0.CODE)
      ORDER BY NAME`;
    const rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date, min_amt }, comp_uid);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runItaxSale(comp_code, comp_uid, p, { forceMinAmt } = {}) {
    const min_amt = forceMinAmt !== undefined ? forceMinAmt : p.min_amt;
    const binds = {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      min_amt,
      v_sl: 'SL',
      v_cn: 'CN',
      v_st: 'ST',
      v_kv: 'KV',
      v_cx: 'CX',
      v_dx: 'DX',
      v_se: 'SE',
      mdet: 'TDS',
    };
    let compYearSql = '';
    if (p.comp_year) {
      compYearSql = ' AND A.COMP_YEAR = :comp_year';
      binds.comp_year = p.comp_year;
    }
    const sql = `
      WITH Y1 AS (
        SELECT CODE FROM SALE WHERE COMP_CODE = :comp_code AND TYPE IN (:v_sl, :v_cn, :v_st, :v_se) GROUP BY CODE
        UNION
        SELECT CODE FROM DBIKRI WHERE COMP_CODE = :comp_code
      ),
      X0 AS (
        SELECT A.CODE, B.NAME, B.PAN, B.TIN, B.GST_NO, B.ADD1, B.ADD2, B.ADD3, B.CITY, B.STATE_CODE, B.STATE,
          COUNT(DISTINCT CASE WHEN A.VR_TYPE IN (:v_sl, :v_cn, :v_st, :v_se)
            THEN TRIM(A.VR_TYPE) || '|' || TO_CHAR(A.VR_DATE, 'YYYYMMDD') || '|' || TRIM(TO_CHAR(A.VR_NO)) || '|' || TRIM(NVL(A.TYPE, ' '))
          END) AS BILL_CNT,
          SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT,
          SUM(CASE WHEN SUBSTR(A.DETAIL, 1, 3) <> :mdet THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS AMOUNT,
          SUM(CASE WHEN SUBSTR(A.DETAIL, 1, 3) = :mdet THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS TDS_AMOUNT
        FROM LEDGER A
        INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code${compYearSql}
          AND A.VR_TYPE IN (:v_sl, :v_cn, :v_st, :v_kv, :v_cx, :v_dx, :v_se)
          AND ${betweenDatesSql('A.VR_DATE')}
        GROUP BY A.CODE, B.NAME, B.PAN, B.TIN, B.GST_NO, B.ADD1, B.ADD2, B.ADD3, B.CITY, B.STATE_CODE, B.STATE
        HAVING SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) > :min_amt
      )
      SELECT X0.* FROM X0
      WHERE EXISTS (SELECT 1 FROM Y1 WHERE Y1.CODE = X0.CODE)
      ORDER BY NAME`;
    let rows = await q(sql, binds, comp_uid);
    if (p.state_code) {
      rows = rows.filter((r) => String(r.STATE_CODE || '').trim() === String(p.state_code).trim());
    }
    if (forceMinAmt !== undefined) {
      rows = appendGrandTotalRow(rows, {
        labelKey: 'NAME',
        labelValue: 'GRAND TOTAL',
        sumKeys: ['BILL_CNT', 'QNTY', 'WEIGHT', 'AMOUNT', 'TDS_AMOUNT'],
      });
    }
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  /** Top N parties by sales amount (default 10). Same ledger base as party-wise-sales. */
  async function runItaxTopPartySale(comp_code, comp_uid, p) {
    const topNRaw = Number(p.top_n) || 0;
    const topN = Math.min(500, Math.max(1, topNRaw > 0 ? Math.floor(topNRaw) : 10));
    const binds = {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      min_amt: 0,
      top_n: topN,
      v_sl: 'SL',
      v_cn: 'CN',
      v_st: 'ST',
      v_kv: 'KV',
      v_cx: 'CX',
      v_dx: 'DX',
      v_se: 'SE',
      mdet: 'TDS',
    };
    let compYearSql = '';
    if (p.comp_year) {
      compYearSql = ' AND A.COMP_YEAR = :comp_year';
      binds.comp_year = p.comp_year;
    }
    const sql = `
      WITH Y1 AS (
        SELECT CODE FROM SALE WHERE COMP_CODE = :comp_code AND TYPE IN (:v_sl, :v_cn, :v_st, :v_se) GROUP BY CODE
        UNION
        SELECT CODE FROM DBIKRI WHERE COMP_CODE = :comp_code
      ),
      X0 AS (
        SELECT A.CODE, B.NAME, B.CITY, B.STATE,
          SUM(NVL(A.QNTY, 0)) AS QNTY,
          SUM(NVL(A.WEIGHT, 0)) AS WEIGHT,
          SUM(CASE WHEN SUBSTR(A.DETAIL, 1, 3) <> :mdet THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS AMOUNT
        FROM LEDGER A
        INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code${compYearSql}
          AND A.VR_TYPE IN (:v_sl, :v_cn, :v_st, :v_kv, :v_cx, :v_dx, :v_se)
          AND ${betweenDatesSql('A.VR_DATE')}
        GROUP BY A.CODE, B.NAME, B.CITY, B.STATE
        HAVING SUM(CASE WHEN SUBSTR(A.DETAIL, 1, 3) <> :mdet THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) > :min_amt
      ),
      RANKED AS (
        SELECT X0.*, ROW_NUMBER() OVER (ORDER BY X0.AMOUNT DESC, X0.NAME) AS RANK_NO
        FROM X0
        WHERE EXISTS (SELECT 1 FROM Y1 WHERE Y1.CODE = X0.CODE)
      )
      SELECT RANK_NO, CODE, NAME, CITY, STATE, QNTY, WEIGHT, AMOUNT
      FROM RANKED
      WHERE RANK_NO <= :top_n
      ORDER BY RANK_NO`;
    let rows = await q(sql, binds, comp_uid);
    rows = appendGrandTotalRow(rows, {
      labelKey: 'NAME',
      labelValue: 'TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'AMOUNT'],
    });
    return { rows, columns: inferColumnsFromRows(rows), meta: { top_n: topN } };
  }

  async function runItaxSch(comp_code, comp_uid, p) {
    const schedule_no = scheduleFilter(p.schedule_no);
    if (!schedule_no) throw new Error('month-schedule-wise-list requires schedule_no');
    const sql = `
      SELECT A.CODE, B.NAME, B.SCHEDULE, C.NAME AS SCH_NAME,
        EXTRACT(MONTH FROM A.VR_DATE) AS MTH,
        TO_CHAR(A.VR_DATE, 'MONTH') AS CMTH,
        EXTRACT(YEAR FROM A.VR_DATE) AS MYEAR,
        SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS AMOUNT,
        SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
        SUM(NVL(A.CR_AMT, 0)) AS CR_AMT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN SCHEDULE C ON B.COMP_CODE = C.COMP_CODE AND B.SCHEDULE = C.NO
      WHERE A.COMP_CODE = :comp_code AND B.SCHEDULE = :schedule_no
      GROUP BY A.CODE, B.NAME, B.SCHEDULE, C.NAME,
        EXTRACT(MONTH FROM A.VR_DATE), TO_CHAR(A.VR_DATE, 'MONTH'), EXTRACT(YEAR FROM A.VR_DATE)
      ORDER BY CODE, MYEAR, MTH`;
    const raw = await q(sql, { comp_code, schedule_no }, comp_uid);
    const mdc = p.mdc || '';
    /** Net Dr−Cr balance per account — used for D/C row filter (not display totals). */
    const netBalByCode = new Map();
    for (const r of raw) {
      const code = String(r.CODE ?? '');
      netBalByCode.set(code, num(netBalByCode.get(code)) + num(r.AMOUNT));
    }
    const detail = raw.map((r) => ({
      ...r,
      MTH_AMT: mdc === 'D' ? num(r.DR_AMT) : mdc === 'C' ? num(r.CR_AMT) : num(r.AMOUNT),
    }));
    let endYear = new Date().getFullYear();
    if (p.e_date) {
      const parts = p.e_date.split('-');
      if (parts.length === 3) endYear = num(parts[2]);
    }
    let rows = pivotFiscalMonths(detail, {
      groupKeys: ['CODE', 'NAME', 'SCHEDULE', 'SCH_NAME'],
      carryFields: ['SCHEDULE', 'SCH_NAME'],
      endYear,
    });
    if (mdc === 'D') {
      rows = rows.filter((r) => num(netBalByCode.get(String(r.CODE))) > 0);
    } else if (mdc === 'C') {
      rows = rows.filter((r) => num(netBalByCode.get(String(r.CODE))) < 0);
    }
    const columns = cols(['CODE', 'NAME', 'SCHEDULE', 'SCH_NAME', 'OP', ...FISCAL_MONTHS.map((m) => m.key), 'TOT']);
    return { rows, columns };
  }

  async function runItaxArh(comp_code, comp_uid, p) {
    const scode = String(p.scode || '').trim();
    if (!scode) throw new Error('customer-arhat requires scode');
    const sql = `
      SELECT A.DC_CODE AS CODE, B.NAME, B.CITY, B.PAN, SUM(NVL(A.CR_AMT, 0)) AS CR_AMT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.DC_CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND A.CODE = :scode
      GROUP BY A.DC_CODE, B.NAME, B.CITY, B.PAN
      ORDER BY NAME, CODE`;
    const rows = await q(sql, { comp_code, scode }, comp_uid);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runDamiWiseSales(comp_code, comp_uid, p) {
    const sql = `
      SELECT TO_CHAR(BILL_DATE, 'MM') AS MTH, TO_CHAR(BILL_DATE, 'YY') AS YR,
        MAX(TO_CHAR(BILL_DATE, 'MON')) AS CMTH,
        SUM(NVL(AMOUNT, 0)) AS AMOUNT,
        SUM(CASE WHEN NVL(COMM_PER, 0) = 1.75 THEN NVL(AMOUNT, 0) ELSE 0 END) AS AMT175,
        SUM(CASE WHEN NVL(COMM_PER, 0) = 3.1250 THEN NVL(AMOUNT, 0) ELSE 0 END) AS AMT3125,
        SUM(CASE WHEN NVL(COMM_PER, 0) <> 3.1250 AND NVL(COMM_PER, 0) <> 1.75 THEN NVL(AMOUNT, 0) ELSE 0 END) AS AMT0
      FROM SALE
      WHERE COMP_CODE = :comp_code AND TYPE IN ('SL', 'SE')
        AND ${billBetweenDatesSql('BILL_DATE')}
      GROUP BY TO_CHAR(BILL_DATE, 'MM'), TO_CHAR(BILL_DATE, 'YY')
      ORDER BY YR, MTH`;
    const detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const rows = mapMonthlySummaryRows(detail, {
      sumKeys: ['AMOUNT', 'AMT175', 'AMT3125', 'AMT0'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runPurRpt(comp_code, comp_uid, p) {
    const schedule_no = scheduleFilter(p.schedule_no);
    if (!schedule_no) throw new Error('monthly-purchase-report requires schedule_no');
    const sql = `
      SELECT TO_CHAR(A.VR_DATE, 'MM') AS MTH, TO_CHAR(A.VR_DATE, 'YY') AS YR,
        MAX(TO_CHAR(A.VR_DATE, 'MON')) AS CMTH,
        SUM(CASE WHEN A.VR_TYPE = 'PU' THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END) AS QNTY,
        SUM(CASE WHEN A.VR_TYPE = 'PU' THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END) AS WEIGHT,
        SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS AMOUNT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND A.VR_TYPE IN ('PU', 'DN')
        AND SUBSTR(A.DETAIL, 1, 3) <> 'TDS'
        AND B.SCHEDULE = :schedule_no
      GROUP BY TO_CHAR(A.VR_DATE, 'MM'), TO_CHAR(A.VR_DATE, 'YY')
      ORDER BY YR, MTH`;
    const detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date, schedule_no }, comp_uid);
    const rows = mapMonthlySummaryRows(detail, {
      sumKeys: ['QNTY', 'WEIGHT', 'AMOUNT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runSaleRpt1(comp_code, comp_uid, p) {
    const binds = {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      sno1: 12.1,
      sno2: 11.1,
      vtp1: 'SL',
      vtp2: 'KV',
      vtp3: 'CN',
      vtp4: 'CX',
      vtp5: 'DX',
      vtp6: 'SE',
    };
    const sql = `
      SELECT TO_CHAR(A.VR_DATE, 'MM') AS MTH, TO_CHAR(A.VR_DATE, 'YY') AS YR,
        MAX(TO_CHAR(A.VR_DATE, 'MON')) AS CMTH,
        SUM(CASE WHEN B.SCHEDULE = :sno1 THEN CASE WHEN A.VR_TYPE IN (:vtp1, :vtp2, :vtp6) THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END ELSE 0 END) AS T_SALE_QTY,
        SUM(CASE WHEN B.SCHEDULE <> :sno1 THEN CASE WHEN A.VR_TYPE IN (:vtp1, :vtp2, :vtp6) THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END ELSE 0 END) AS C_SALE_QTY,
        SUM(CASE WHEN B.SCHEDULE = :sno1 THEN CASE WHEN A.VR_TYPE IN (:vtp1, :vtp2, :vtp6) THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END ELSE 0 END) AS T_SALE_WGT,
        SUM(CASE WHEN B.SCHEDULE <> :sno1 THEN CASE WHEN A.VR_TYPE IN (:vtp1, :vtp2, :vtp6) THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END ELSE 0 END) AS C_SALE_WGT,
        SUM(CASE WHEN B.SCHEDULE = :sno1 THEN NVL(A.CR_AMT, 0) - NVL(A.DR_AMT, 0) ELSE 0 END) AS T_SALE,
        SUM(CASE WHEN B.SCHEDULE <> :sno1 THEN NVL(A.CR_AMT, 0) - NVL(A.DR_AMT, 0) ELSE 0 END) AS C_SALE,
        SUM(CASE WHEN A.VR_TYPE IN (:vtp1, :vtp2, :vtp6) THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END) AS QNTY,
        SUM(CASE WHEN A.VR_TYPE IN (:vtp1, :vtp2, :vtp6) THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END) AS WEIGHT,
        SUM(NVL(A.CR_AMT, 0) - NVL(A.DR_AMT, 0)) AS TOT_SALE
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND A.VR_TYPE IN (:vtp1, :vtp2, :vtp3, :vtp4, :vtp5, :vtp6)
        AND B.SCHEDULE IN (:sno1, :sno2)
      GROUP BY TO_CHAR(A.VR_DATE, 'MM'), TO_CHAR(A.VR_DATE, 'YY')
      ORDER BY YR, MTH`;
    const detail = await q(sql, binds, comp_uid);
    const withAmount = detail.map((raw) => {
      const row = normalizeRow(raw);
      return { ...row, AMOUNT: num(row.TOT_SALE) };
    });
    const rows = mapMonthlySummaryRows(withAmount, {
      sumKeys: [
        'T_SALE_QTY',
        'C_SALE_QTY',
        'T_SALE_WGT',
        'C_SALE_WGT',
        'T_SALE',
        'C_SALE',
        'QNTY',
        'WEIGHT',
        'AMOUNT',
      ],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItmSalPur(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.ITEM_CODE, B.ITEM_NAME, TO_CHAR(A.VR_DATE, 'MM') AS MTH, TO_CHAR(A.VR_DATE, 'YY') AS YR,
        MAX(TO_CHAR(A.VR_DATE, 'MON')) AS CMTH,
        SUM(CASE WHEN A.VR_TYPE = 'PU' AND NVL(A.DR_AMT, 0) <> 0 THEN NVL(A.QNTY, 0) ELSE 0 END) AS P_QTY,
        SUM(CASE WHEN A.VR_TYPE = 'DN' AND NVL(A.DR_AMT, 0) <> 0 THEN NVL(A.QNTY, 0) ELSE 0 END) AS D_QTY,
        SUM(CASE WHEN A.VR_TYPE = 'PU' AND NVL(A.DR_AMT, 0) <> 0 THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS P_WGT,
        SUM(CASE WHEN A.VR_TYPE = 'DN' AND NVL(A.DR_AMT, 0) <> 0 THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS D_WGT,
        SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 THEN NVL(A.DR_AMT, 0) ELSE 0 END) AS P_AMT,
        SUM(CASE WHEN A.VR_TYPE IN ('SL', 'SE') AND NVL(A.CR_AMT, 0) <> 0 THEN NVL(A.QNTY, 0) ELSE 0 END) AS S_QTY,
        SUM(CASE WHEN A.VR_TYPE = 'CN' AND NVL(A.CR_AMT, 0) <> 0 THEN NVL(A.QNTY, 0) ELSE 0 END) AS C_QTY,
        SUM(CASE WHEN A.VR_TYPE IN ('SL', 'SE') AND NVL(A.CR_AMT, 0) <> 0 THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS S_WGT,
        SUM(CASE WHEN A.VR_TYPE = 'CN' AND NVL(A.CR_AMT, 0) <> 0 THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS C_WGT,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 THEN NVL(A.CR_AMT, 0) ELSE 0 END) AS S_AMT
      FROM LEDGER A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND A.VR_TYPE IN ('SL', 'KV', 'PU', 'CN', 'CX', 'DX', 'SE')
        AND NVL(A.ITEM_CODE, 0) <> 0
        AND A.CODE IN (
          SELECT C.CODE FROM MASTER C
          WHERE A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE AND C.SCHEDULE IN (12.1, 14.1)
        )
      GROUP BY A.ITEM_CODE, B.ITEM_NAME, TO_CHAR(A.VR_DATE, 'MM'), TO_CHAR(A.VR_DATE, 'YY')
      ORDER BY ITEM_NAME, ITEM_CODE, YR, MTH`;
    const detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const adjusted = detail.map((raw) => {
      const row = normalizeRow(raw);
      return {
        ...row,
        CMTH: formatCmthYear(row.CMTH, row.YR),
      };
    });
    const rows = appendGrandTotalRow(adjusted, {
      labelKey: 'CMTH',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['P_QTY', 'D_QTY', 'P_WGT', 'D_WGT', 'P_AMT', 'S_QTY', 'C_QTY', 'S_WGT', 'C_WGT', 'S_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItmSale(comp_code, comp_uid, p) {
    const sqlSale = `
      SELECT A.TYPE, A.ITEM_CODE, B.ITEM_NAME, C.STATE, C.STATE_CODE,
        TO_CHAR(A.BILL_DATE, 'MM') AS MTH, TO_CHAR(A.BILL_DATE, 'YY') AS YR,
        MAX(TO_CHAR(A.BILL_DATE, 'MON')) AS CMTH,
        SUM(NVL(A.WEIGHT, 0) - (NVL(A.DANE_WGT, 0) + NVL(A.PAPLOO3, 0))) AS WEIGHT,
        SUM(NVL(A.AMOUNT, 0) - (NVL(A.P_AMT1, 0) + NVL(A.P_AMT2, 0) + NVL(A.P_AMT3, 0) + NVL(A.P_AMT4, 0) + NVL(A.P_AMT5, 0) + NVL(A.DANE_AMT, 0) + NVL(A.S_EXP1, 0) + NVL(A.S_EXP2, 0) + NVL(A.S_EXP3, 0))) AS AMOUNT,
        SUM(NVL(A.QNTY, 0)) AS QNTY,
        SUM(CASE WHEN NVL(A.BROKERAGE, 0) <> 0 THEN NVL(A.COMMISSION, 0) + NVL(A.BROKERAGE, 0) ELSE NVL(A.COMMISSION, 0) END) AS S_COMM
      FROM SALE A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('SL', 'CN', 'SE')
      GROUP BY A.TYPE, A.ITEM_CODE, B.ITEM_NAME, C.STATE, C.STATE_CODE,
        TO_CHAR(A.BILL_DATE, 'MM'), TO_CHAR(A.BILL_DATE, 'YY')
      ORDER BY ITEM_CODE, TYPE`;
    const sqlSv = `
      SELECT 'SV' AS TYPE, A.ITEM_CODE, B.ITEM_NAME,
        TO_CHAR(A.SV_DATE, 'MM') AS MTH, TO_CHAR(A.SV_DATE, 'YY') AS YR,
        MAX(TO_CHAR(A.SV_DATE, 'MON')) AS CMTH,
        SUM(NVL(A.WEIGHT, 0)) AS WEIGHT,
        SUM(NVL(A.AMOUNT, 0) - (NVL(A.OTH_EXP1, 0) + NVL(A.OTH_EXP2, 0) + NVL(A.OTH_EXP3, 0) + NVL(A.OTH_EXP4, 0) + NVL(A.OTH_EXP5, 0) + NVL(A.OTH_EXP6, 0))) AS AMOUNT,
        SUM(NVL(A.QNTY, 0)) AS QNTY, 0 AS S_COMM, '' AS STATE, '' AS STATE_CODE
      FROM DBIKRI A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.SV_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
      GROUP BY A.ITEM_CODE, B.ITEM_NAME, TO_CHAR(A.SV_DATE, 'MM'), TO_CHAR(A.SV_DATE, 'YY')
      ORDER BY ITEM_CODE`;
    const binds = { comp_code, s_date: p.s_date, e_date: p.e_date };
    const x1 = await q(sqlSale, binds, comp_uid);
    const x3 = await q(sqlSv, binds, comp_uid);
    const merged = [...x1, ...x3].map((r) => ({
      TYPE: r.TYPE,
      ITEM_CODE: r.ITEM_CODE,
      ITEM_NAME: r.ITEM_NAME,
      CMTH: r.CMTH,
      MTH: r.MTH,
      YR: r.YR,
      S_QTY: num(r.QNTY),
      S_WGT: num(r.WEIGHT),
      S_AMT: num(r.AMOUNT),
      S_COMM: num(r.S_COMM),
      STATE_CODE: String(r.STATE_CODE || '').trim(),
    }));
    let grouped = groupSaleCn(merged, ['ITEM_CODE', 'ITEM_NAME', 'CMTH', 'MTH', 'YR'], ['S_QTY', 'S_WGT', 'S_AMT', 'S_COMM']);
    grouped = grouped.map((r) => ({
      ...r,
      STATE_CODE: merged.find((m) => m.ITEM_CODE === r.ITEM_CODE && m.MTH === r.MTH)?.STATE_CODE || '',
    }));
    if (p.state_code) {
      grouped = grouped.filter((r) => String(r.STATE_CODE || '').trim() === String(p.state_code).trim());
    }
    const adjusted = grouped.map((raw) => {
      const row = normalizeRow(raw);
      return {
        ...row,
        CMTH: formatCmthYear(row.CMTH, row.YR),
      };
    });
    adjusted.sort((a, b) => {
      const byCode = String(a.ITEM_CODE ?? '').localeCompare(String(b.ITEM_CODE ?? ''));
      if (byCode !== 0) return byCode;
      return String(a.CMTH ?? '').localeCompare(String(b.CMTH ?? ''));
    });
    const rows = appendGrandTotalRow(adjusted, {
      labelKey: 'CMTH',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['S_QTY', 'S_WGT', 'S_AMT', 'S_COMM'],
    });
    return { rows, columns: inferColumnsFromRows(adjusted) };
  }

  async function runItaxPurBill(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.SUP_CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, A.R_DATE, A.R_NO, A.BILL_NO,
        MAX(A.TYPE) AS TYPE,
        MAX(C.ITEM_NAME) AS ITEM_NAME,
        SUM(CASE WHEN A.TYPE = 'DN' THEN NVL(A.QNTY, 0) * -1 ELSE NVL(A.QNTY, 0) END) AS QNTY,
        SUM(CASE WHEN A.TYPE = 'DN' THEN NVL(A.WEIGHT, 0) * -1 ELSE NVL(A.WEIGHT, 0) END) AS WEIGHT,
        MAX(A.RATE) AS RATE,
        SUM(CASE WHEN A.TYPE = 'DN' THEN NVL(A.AMOUNT, 0) * -1 ELSE NVL(A.AMOUNT, 0) END) AS AMOUNT,
        SUM(CASE WHEN A.TYPE = 'DN' THEN NVL(A.BILL_AMT, 0) * -1 ELSE NVL(A.BILL_AMT, 0) END) AS BILL_AMT
      FROM PURCHASE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.SUP_CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${rDateBetweenSql('A.R_DATE')}
      GROUP BY A.SUP_CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, A.R_DATE, A.R_NO, A.BILL_NO
      ORDER BY NAME, SUP_CODE, R_DATE, R_NO`;
    const detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'R_DATE',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'AMOUNT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxSaleBill(comp_code, comp_uid, p) {
    const schedule_no = scheduleFilter(p.schedule_no);
    const schSql = schedule_no
      ? ' AND D.SCHEDULE = :schedule_no'
      : '';
    const sql = `
      SELECT A.TYPE, A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, A.BILL_DATE, A.BILL_NO, A.B_TYPE,
        D.SCHEDULE, A.ITEM_CODE, C.ITEM_NAME, A.RATE,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT, SUM(NVL(A.AMOUNT, 0)) AS BILL_AMT
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      INNER JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.SUP_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}${schSql}
      GROUP BY A.TYPE, A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, A.BILL_DATE, A.BILL_NO, A.B_TYPE,
        D.SCHEDULE, A.ITEM_CODE, C.ITEM_NAME, A.RATE
      ORDER BY NAME, CODE, BILL_DATE, BILL_NO`;
    const binds = { comp_code, s_date: p.s_date, e_date: p.e_date };
    if (schedule_no) binds.schedule_no = schedule_no;
    const x1 = (await q(sql, binds, comp_uid)).filter((r) => ['SL', 'CN', 'SE'].includes(String(r.TYPE || '').toUpperCase()));
    const grouped = groupSaleCn(
      x1,
      ['CODE', 'NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO', 'BILL_DATE', 'BILL_NO', 'B_TYPE', 'ITEM_CODE', 'ITEM_NAME', 'RATE'],
      ['QNTY', 'WEIGHT', 'BILL_AMT']
    );
    const rows = appendGrandTotalRow(grouped, {
      labelKey: 'BILL_DATE',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(grouped) };
  }

  async function runItaxPurItem(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.SUP_CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, A.ITEM_CODE, MAX(C.ITEM_NAME) AS ITEM_NAME,
        SUM(CASE WHEN A.TYPE = 'DN' THEN NVL(A.QNTY, 0) * -1 ELSE NVL(A.QNTY, 0) END) AS QNTY,
        SUM(CASE WHEN A.TYPE = 'DN' THEN NVL(A.WEIGHT, 0) * -1 ELSE NVL(A.WEIGHT, 0) END) AS WEIGHT,
        MAX(A.RATE) AS RATE,
        SUM(CASE WHEN A.TYPE = 'DN' THEN (NVL(A.AMOUNT, 0) + NVL(A.COMM_AMT, 0) + NVL(A.TAX_AMT, 0) + NVL(A.OTH_EXP_1, 0) + NVL(A.OTH_EXP_2, 0)) * -1
          ELSE NVL(A.AMOUNT, 0) + NVL(A.COMM_AMT, 0) + NVL(A.TAX_AMT, 0) + NVL(A.OTH_EXP_1, 0) + NVL(A.OTH_EXP_2, 0) END) AS BILL_AMT
      FROM PURCHASE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.SUP_CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${rDateBetweenSql('A.R_DATE')}
      GROUP BY A.SUP_CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, A.ITEM_CODE
      ORDER BY NAME, SUP_CODE, ITEM_CODE`;
    const detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'ITEM_NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxSaleItem(comp_code, comp_uid, p) {
    const scode = String(p.scode || '').trim();
    const sql = `
      SELECT A.TYPE, A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, B.STATE_CODE, B.STATE, A.ITEM_CODE,
        MAX(C.ITEM_NAME) AS ITEM_NAME,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT, MAX(A.RATE) AS RATE,
        SUM(NVL(A.AMOUNT, 0) + NVL(A.COMMISSION, 0) + NVL(A.TAX_AMT, 0) + NVL(A.FREIGHT, 0) + NVL(A.LABOUR, 0)) AS BILL_AMT
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('CN', 'SL', 'SE')
        AND (:scode IS NULL OR :scode = '' OR A.CODE = :scode)
      GROUP BY A.TYPE, A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, B.STATE_CODE, B.STATE, A.ITEM_CODE
      ORDER BY NAME, CODE, ITEM_CODE`;
    const binds = { comp_code, s_date: p.s_date, e_date: p.e_date, scode: scode || null };
    const x1 = await q(sql, binds, comp_uid);
    let detail = groupSaleCn(
      x1,
      ['CODE', 'NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO', 'STATE_CODE', 'STATE', 'ITEM_CODE', 'ITEM_NAME'],
      ['QNTY', 'WEIGHT', 'BILL_AMT']
    );
    const wgtKq = p.wgt_kq || 'Q';
    detail = detail.map((r) => {
      const w = num(r.WEIGHT);
      const bill = num(r.BILL_AMT);
      const rate = w !== 0 ? (wgtKq === 'Q' ? bill / w : (bill / w) * 100) : 0;
      return { ...r, RATE: Math.round(rate * 100) / 100 };
    });
    if (p.state_code) detail = detail.filter((r) => String(r.STATE_CODE || '').trim() === String(p.state_code).trim());
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'ITEM_NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxItemSale(comp_code, comp_uid, p) {
    const scode = String(p.scode || '').trim();
    const sql = `
      SELECT A.TYPE, A.CODE, B.NAME, B.CITY, B.PAN, B.STATE_CODE, B.STATE, A.ITEM_CODE,
        MAX(C.ITEM_NAME) AS ITEM_NAME, MAX(A.RATE) AS RATE,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT,
        SUM(NVL(A.AMOUNT, 0)) AS BILL_AMT
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('SL', 'CN', 'SE')
        AND (:scode IS NULL OR :scode = '' OR A.CODE = :scode)
      GROUP BY A.TYPE, A.CODE, B.NAME, B.CITY, B.PAN, B.STATE_CODE, B.STATE, A.ITEM_CODE
      ORDER BY ITEM_CODE, NAME, CODE`;
    const binds = { comp_code, s_date: p.s_date, e_date: p.e_date, scode: scode || null };
    const x1 = await q(sql, binds, comp_uid);
    let detail = groupSaleCn(x1, ['ITEM_CODE', 'ITEM_NAME', 'CODE', 'NAME', 'CITY', 'PAN', 'STATE_CODE', 'STATE'], ['QNTY', 'WEIGHT', 'BILL_AMT']);
    detail = detail.map((r) => {
      const maxRate = x1.filter((x) => x.ITEM_CODE === r.ITEM_CODE && x.CODE === r.CODE).reduce((m, x) => Math.max(m, num(x.RATE)), 0);
      return { ...r, RATE: maxRate };
    });
    if (p.icode) detail = detail.filter((r) => num(r.ITEM_CODE) === num(p.icode));
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxSaleMth(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.TYPE, A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, B.STATE_CODE, B.STATE,
        TO_CHAR(A.BILL_DATE, 'MM') AS MTH, TO_CHAR(A.BILL_DATE, 'YYYY') AS YR,
        MAX(TO_CHAR(A.BILL_DATE, 'MON')) AS CMTH,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT, MAX(A.RATE) AS RATE,
        SUM(NVL(A.AMOUNT, 0) + NVL(A.COMMISSION, 0) + NVL(A.TAX_AMT, 0) + NVL(A.FREIGHT, 0) + NVL(A.LABOUR, 0)) AS BILL_AMT
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('SL', 'CN', 'SE')
      GROUP BY A.TYPE, A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.PAN, B.GST_NO, B.STATE_CODE, B.STATE,
        TO_CHAR(A.BILL_DATE, 'MM'), TO_CHAR(A.BILL_DATE, 'YYYY')
      ORDER BY NAME, CODE, YR, MTH`;
    const x1 = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    let detail = groupSaleCn(
      x1,
      ['CODE', 'NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO', 'STATE_CODE', 'STATE', 'MTH', 'YR', 'CMTH'],
      ['QNTY', 'WEIGHT', 'BILL_AMT']
    );
    detail = detail.map((r) => ({
      ...r,
      CMTH: formatCmthYear(r.CMTH, r.YR),
      RATE: x1
        .filter((x) => x.CODE === r.CODE && x.MTH === r.MTH && x.YR === r.YR)
        .reduce((m, x) => Math.max(m, num(x.RATE)), 0),
    }));
    if (p.state_code) detail = detail.filter((r) => String(r.STATE_CODE || '').trim() === String(p.state_code).trim());
    detail.sort((a, b) => {
      const byName = String(a.NAME ?? '').localeCompare(String(b.NAME ?? ''));
      if (byName !== 0) return byName;
      const byCode = String(a.CODE ?? '').localeCompare(String(b.CODE ?? ''));
      if (byCode !== 0) return byCode;
      const byYr = String(a.YR ?? '').localeCompare(String(b.YR ?? ''));
      if (byYr !== 0) return byYr;
      return String(a.MTH ?? '').localeCompare(String(b.MTH ?? ''));
    });
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'CMTH',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxSaleItemMth(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.TYPE, A.ITEM_CODE, B.ITEM_NAME, A.CODE, C.NAME, C.ADD1, C.ADD2, C.CITY, C.PAN, C.GST_NO,
        TO_CHAR(A.BILL_DATE, 'MM') AS MTH, TO_CHAR(A.BILL_DATE, 'YYYY') AS YR,
        MAX(TO_CHAR(A.BILL_DATE, 'MON')) AS CMTH,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT, MAX(A.RATE) AS RATE,
        SUM(NVL(A.AMOUNT, 0) + NVL(A.COMMISSION, 0) + NVL(A.TAX_AMT, 0) + NVL(A.FREIGHT, 0) + NVL(A.LABOUR, 0)) AS BILL_AMT
      FROM SALE A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      INNER JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('SL', 'CN', 'SE')
      GROUP BY A.TYPE, A.ITEM_CODE, B.ITEM_NAME, A.CODE, C.NAME, C.ADD1, C.ADD2, C.CITY, C.PAN, C.GST_NO,
        TO_CHAR(A.BILL_DATE, 'MM'), TO_CHAR(A.BILL_DATE, 'YYYY')
      ORDER BY ITEM_CODE, C.NAME, A.CODE, YR, MTH`;
    let x1 = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (p.icode) x1 = x1.filter((r) => num(r.ITEM_CODE) === num(p.icode));
    let detail = groupSaleCn(
      x1,
      ['ITEM_CODE', 'ITEM_NAME', 'CODE', 'NAME', 'ADD1', 'ADD2', 'CITY', 'PAN', 'GST_NO', 'MTH', 'YR', 'CMTH'],
      ['QNTY', 'WEIGHT', 'BILL_AMT']
    );
    detail = detail.map((r) => ({
      ...r,
      CMTH: formatCmthYear(r.CMTH, r.YR),
      RATE: x1
        .filter(
          (x) =>
            x.ITEM_CODE === r.ITEM_CODE &&
            x.CODE === r.CODE &&
            x.MTH === r.MTH &&
            x.YR === r.YR
        )
        .reduce((m, x) => Math.max(m, num(x.RATE)), 0),
    }));
    detail.sort((a, b) => {
      const byItem = String(a.ITEM_CODE ?? '').localeCompare(String(b.ITEM_CODE ?? ''), undefined, { numeric: true });
      if (byItem !== 0) return byItem;
      const byName = String(a.NAME ?? '').localeCompare(String(b.NAME ?? ''));
      if (byName !== 0) return byName;
      const byCode = String(a.CODE ?? '').localeCompare(String(b.CODE ?? ''));
      if (byCode !== 0) return byCode;
      const byYr = String(a.YR ?? '').localeCompare(String(b.YR ?? ''));
      if (byYr !== 0) return byYr;
      return String(a.MTH ?? '').localeCompare(String(b.MTH ?? ''));
    });
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'CMTH',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxSaleCust(comp_code, comp_uid, p) {
    const scode = String(p.scode || '').trim();
    const god_code = String(p.god_code || '').trim();
    const icode = num(p.icode);
    const minRate = p.min_amt > 0 ? p.min_amt : 1800;
    const sql = `
      SELECT A.TYPE, A.CODE, C.NAME, C.CITY,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT,
        MAX(A.RATE) AS RATE, SUM(NVL(A.AMOUNT, 0)) AS BILL_AMT
      FROM SALE A
      INNER JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('SL', 'CN', 'SE') AND A.RATE >= :min_rate
        AND (:scode IS NULL OR :scode = '' OR A.SUP_CODE = :scode)
        AND (:icode = 0 OR A.ITEM_CODE = :icode)
        AND (:god_code IS NULL OR :god_code = '' OR A.GOD_CODE = :god_code)
      GROUP BY A.TYPE, A.CODE, C.NAME, C.CITY
      ORDER BY CODE, NAME`;
    const x1 = await q(sql, {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      min_rate: minRate,
      scode: scode || null,
      icode,
      god_code: god_code || null,
    }, comp_uid);
    const detail = groupSaleCn(x1, ['CODE', 'NAME', 'CITY'], ['QNTY', 'WEIGHT', 'BILL_AMT']).map((r) => ({
      ...r,
      RATE: x1.filter((x) => x.CODE === r.CODE).reduce((m, x) => Math.max(m, num(x.RATE)), 0),
    }));
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxPurItemMth(comp_code, comp_uid, p) {
    const bk_code = String(p.bk_code || '').trim();
    const sql = `
      SELECT A.ITEM_CODE, B.ITEM_NAME, A.CODE, C.NAME, C.CITY,
        TO_CHAR(A.R_DATE, 'MM') AS MTH, TO_CHAR(A.R_DATE, 'YYYY') AS YR,
        MAX(TO_CHAR(A.R_DATE, 'MON')) AS CMTH,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT, MAX(A.RATE) AS RATE,
        SUM(NVL(A.AMOUNT, 0) + NVL(A.COMM_AMT, 0) + NVL(A.TAX_AMT, 0) + NVL(A.MISC_EXP, 0)) AS BILL_AMT
      FROM PURCHASE A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      INNER JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code AND ${rDateBetweenSql('A.R_DATE')}
        AND (:bk_code IS NULL OR :bk_code = '' OR A.B_CODE = :bk_code)
      GROUP BY A.ITEM_CODE, B.ITEM_NAME, A.CODE, C.NAME, C.CITY,
        TO_CHAR(A.R_DATE, 'MM'), TO_CHAR(A.R_DATE, 'YYYY')
      ORDER BY A.ITEM_CODE, B.ITEM_NAME, C.NAME, A.CODE, YR, MTH`;
    let detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date, bk_code: bk_code || null }, comp_uid);
    if (p.icode) detail = detail.filter((r) => num(r.ITEM_CODE) === num(p.icode));
    detail = detail.map((r) => ({
      ITEM_CODE: r.ITEM_CODE,
      ITEM_NAME: r.ITEM_NAME,
      CODE: r.CODE,
      NAME: r.NAME,
      CITY: r.CITY,
      CMTH: formatCmthYear(r.CMTH, r.YR),
      QNTY: r.QNTY,
      WEIGHT: r.WEIGHT,
      RATE: r.RATE,
      BILL_AMT: r.BILL_AMT,
    }));
    detail.sort((a, b) => {
      const byItem = String(a.ITEM_CODE ?? '').localeCompare(String(b.ITEM_CODE ?? ''), undefined, { numeric: true });
      if (byItem !== 0) return byItem;
      const byName = String(a.NAME ?? '').localeCompare(String(b.NAME ?? ''));
      if (byName !== 0) return byName;
      const byCode = String(a.CODE ?? '').localeCompare(String(b.CODE ?? ''));
      if (byCode !== 0) return byCode;
      return String(a.CMTH ?? '').localeCompare(String(b.CMTH ?? ''));
    });
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'CMTH',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runItaxItemPur(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.CODE, B.NAME, B.CITY, B.PAN, A.ITEM_CODE, MAX(C.ITEM_NAME) AS ITEM_NAME,
        SUM(NVL(A.QNTY, 0)) AS QNTY, SUM(NVL(A.WEIGHT, 0)) AS WEIGHT, MAX(A.RATE) AS RATE,
        SUM(NVL(A.AMOUNT, 0)) AS BILL_AMT
      FROM PURCHASE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${rDateBetweenSql('A.R_DATE')}
      GROUP BY A.CODE, B.NAME, B.CITY, B.PAN, A.ITEM_CODE
      ORDER BY A.ITEM_CODE, ITEM_NAME, B.NAME, A.CODE`;
    const detail = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['QNTY', 'WEIGHT', 'BILL_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runLotPurSale(comp_code, comp_uid, p) {
    const weightFld = String(p.stk_tdg_wgt_type || '').toUpperCase() === 'G' ? 'A.G_WEIGHT' : 'A.WEIGHT';
    const sql = `
      SELECT A.ITEM_CODE, A.LOT, A.STATUS, A.B_NO, A.SUP_CODE, C.ITEM_NAME, D.NAME, A.GOD_CODE,
        A.VR_DATE, A.VR_NO, A.VR_TYPE, A.REMARKS,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS R_QNTY,
        CASE WHEN A.E_TYPE <> 'R' THEN NVL(A.QNTY, 0) ELSE 0 END AS S_QNTY,
        CASE WHEN A.E_TYPE = 'R' THEN NVL(${weightFld}, 0) ELSE 0 END AS R_WEIGHT,
        CASE WHEN A.E_TYPE <> 'R' THEN NVL(${weightFld}, 0) ELSE 0 END AS S_WEIGHT,
        A.RATE, A.AMOUNT, A.DANE, A.PAPLOO1, A.PAPLOO2, A.PAPLOO3, A.PAPLOO5,
        A.COMMISSION, A.BROKERAGE, E.NAME AS CUST_NAME, A.ITEM_CAT, D.SCHEDULE,
        A.MSUP_CODE, F.NAME AS MSUP_NAME
      FROM LOTSTOCK A
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      INNER JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.SUP_CODE = D.CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.CODE = E.CODE
      LEFT JOIN MASTER F ON A.COMP_CODE = F.COMP_CODE AND A.MSUP_CODE = F.CODE
      WHERE A.COMP_CODE = :comp_code AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
      ORDER BY A.B_NO, A.SUP_CODE, A.ITEM_CODE, A.LOT, A.VR_DATE, A.VR_TYPE, A.VR_NO`;
    let rows = await q(sql, { comp_code, e_date: p.e_date }, comp_uid);
    const scode = String(p.scode || '').trim();
    if (scode) rows = rows.filter((r) => String(r.SUP_CODE || '').trim() === scode);
    if (p.icode) rows = rows.filter((r) => num(r.ITEM_CODE) === num(p.icode));
    if (p.b_no) rows = rows.filter((r) => num(r.B_NO) === num(p.b_no));
    const sch = scheduleFilter(p.schedule_no);
    if (sch) rows = rows.filter((r) => num(r.SCHEDULE) === sch);
    const sumKeys = [
      'R_QNTY', 'S_QNTY', 'R_WEIGHT', 'S_WEIGHT', 'AMOUNT', 'DANE',
      'PAPLOO1', 'PAPLOO2', 'PAPLOO3', 'PAPLOO5', 'COMMISSION', 'BROKERAGE',
    ];
    rows = appendLotBillGrandTotalRow(rows, { labelKey: 'B_NO', labelValue: 'GRAND TOTAL', sumKeys });
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runPsaleNew(comp_code, comp_uid, p) {
    const selfDalal = String(p.self_dalal_code || '').trim();
    const sql = `
      SELECT A.CODE,
        MAX(NVL(B.NAME, '')) AS NAME, MAX(NVL(B.ADD1, '')) AS ADD1, MAX(NVL(B.ADD2, '')) AS ADD2,
        MAX(NVL(B.CITY, '')) AS CITY, MAX(NVL(B.PAN, '')) AS PAN, MAX(NVL(B.TIN, '')) AS TIN,
        MAX(NVL(B.GST_NO, '')) AS GST_NO,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS TDG_WGT,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS CONSG_WGT,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN NVL(A.AMOUNT, 0) - (NVL(A.P_AMT1, 0) + NVL(A.P_AMT2, 0) + NVL(A.P_AMT3, 0) + NVL(A.P_AMT4, 0) + NVL(A.P_AMT5, 0) + NVL(A.DANE_AMT, 0)) ELSE 0 END) AS TDG_SALE,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN NVL(A.AMOUNT, 0) - (NVL(A.P_AMT1, 0) + NVL(A.P_AMT2, 0) + NVL(A.P_AMT3, 0) + NVL(A.P_AMT4, 0) + NVL(A.P_AMT5, 0) + NVL(A.DANE_AMT, 0)) ELSE 0 END) AS CONSG_SALE,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN NVL(A.P_AMT1, 0) + NVL(A.P_AMT2, 0) + NVL(A.P_AMT3, 0) + NVL(A.P_AMT4, 0) + NVL(A.P_AMT5, 0) ELSE 0 END) AS TDG_PAP,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN NVL(A.P_AMT1, 0) + NVL(A.P_AMT2, 0) + NVL(A.P_AMT3, 0) + NVL(A.P_AMT4, 0) + NVL(A.P_AMT5, 0) ELSE 0 END) AS CONSG_PAP,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN NVL(A.DANE_AMT, 0) ELSE 0 END) AS TDG_DANE,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN NVL(A.DANE_AMT, 0) ELSE 0 END) AS CONSG_DANE,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN NVL(A.COMMISSION, 0) ELSE 0 END) AS TDG_COMM,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN NVL(A.COMMISSION, 0) ELSE 0 END) AS CONSG_COMM,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN NVL(A.BROKERAGE, 0) ELSE 0 END) AS TDG_BROK,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN NVL(A.BROKERAGE, 0) ELSE 0 END) AS CONSG_BROK,
        SUM(CASE WHEN C.SCHEDULE = 12.1 THEN (NVL(A.TAX_AMT, 0) + NVL(A.FREIGHT, 0) + NVL(A.LABOUR, 0) + NVL(A.OTH_EXP1, 0) + NVL(A.OTH_EXP2, 0) + NVL(A.OTH_EXP3, 0) + NVL(A.OTH_EXP4, 0) + NVL(A.OTH_EXP5, 0) + NVL(A.ARH_AMT, 0)) - NVL(A.DIS_AMT, 0) ELSE 0 END) AS TDG_EXP,
        SUM(CASE WHEN C.SCHEDULE <> 12.1 THEN (NVL(A.TAX_AMT, 0) + NVL(A.FREIGHT, 0) + NVL(A.LABOUR, 0) + NVL(A.OTH_EXP1, 0) + NVL(A.OTH_EXP2, 0) + NVL(A.OTH_EXP3, 0) + NVL(A.OTH_EXP4, 0) + NVL(A.OTH_EXP5, 0) + NVL(A.ARH_AMT, 0)) - NVL(A.DIS_AMT, 0) ELSE 0 END) AS CONSG_EXP,
        SUM(CASE WHEN NVL(A.COMMISSION, 0) = 0 THEN NVL(A.BROKERAGE, 0) ELSE 0 END) AS WOCOMM_BROK,
        SUM(CASE WHEN NVL(A.COMMISSION, 0) <> 0 AND A.BK_CODE = :self_dalal THEN NVL(A.BROKERAGE, 0) ELSE 0 END) AS COMM_SD_BROK,
        SUM(CASE WHEN NVL(A.COMMISSION, 0) = 0 AND A.BK_CODE = :self_dalal THEN NVL(A.BROKERAGE, 0) ELSE 0 END) AS WOCOMM_SD_BROK
      FROM SALE A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.SUP_CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code AND A.TYPE IN ('SL', 'SE')
        AND ${billBetweenDatesSql('A.BILL_DATE')}
      GROUP BY A.CODE
      ORDER BY CODE, NAME`;
    const raw = await q(sql, {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      self_dalal: selfDalal || ' ',
    }, comp_uid);
    const saleRows = raw.map((r) => {
      const net =
        num(r.TDG_SALE) + num(r.CONSG_SALE) + num(r.TDG_COMM) + num(r.CONSG_COMM) +
        num(r.TDG_BROK) + num(r.CONSG_BROK) + num(r.TDG_EXP) + num(r.CONSG_EXP) +
        num(r.TDG_DANE) + num(r.CONSG_DANE) + num(r.TDG_PAP) + num(r.CONSG_PAP) -
        num(r.WOCOMM_BROK) - num(r.COMM_SD_BROK) - num(r.WOCOMM_SD_BROK);
      return { ...r, NET_SALE: net };
    });

    const opSql = `
      SELECT A.CODE, SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS OP_BAL
      FROM LEDGER A
      WHERE A.COMP_CODE = :comp_code AND A.VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      GROUP BY A.CODE`;
    const opMap = new Map(
      (await q(opSql, { comp_code, s_date: p.s_date }, comp_uid)).map((r) => [
        String(r.CODE ?? '').trim(),
        num(r.OP_BAL),
      ])
    );

    const rcptSql = `
      SELECT A.CODE, SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS PMT_AMT
      FROM LEDGER A
      WHERE A.COMP_CODE = :comp_code AND ${betweenDatesSql('A.VR_DATE')}
        AND A.VR_TYPE IN ('CV', 'BV', 'JV')
      GROUP BY A.CODE`;
    const rcptMap = new Map(
      (await q(rcptSql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid)).map((r) => [
        String(r.CODE ?? '').trim(),
        num(r.PMT_AMT),
      ])
    );

    const enriched = saleRows.map((r) => {
      const code = String(r.CODE ?? '').trim();
      const opBal = opMap.get(code) ?? 0;
      const sale = num(r.NET_SALE);
      const pmtAmt = rcptMap.get(code) ?? 0;
      const receipts = Math.abs(pmtAmt);
      const clBal = opBal + sale + pmtAmt;
      return { ...r, OP_BAL: opBal, SALE: sale, RECEIPTS: receipts, CL_BAL: clBal };
    });

    const sumKeys = [
      'TDG_WGT', 'CONSG_WGT', 'TDG_SALE', 'CONSG_SALE', 'TDG_PAP', 'CONSG_PAP',
      'TDG_DANE', 'CONSG_DANE', 'TDG_COMM', 'CONSG_COMM', 'TDG_BROK', 'CONSG_BROK',
      'TDG_EXP', 'CONSG_EXP', 'WOCOMM_BROK', 'COMM_SD_BROK', 'WOCOMM_SD_BROK',
      'NET_SALE', 'OP_BAL', 'SALE', 'RECEIPTS', 'CL_BAL',
    ];
    const rows = appendGrandTotalRow(enriched, {
      labelKey: 'NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys,
    });
    return { rows, columns: inferColumnsFromRows(enriched) };
  }

  async function runPartySaleDet(comp_code, comp_uid, p) {
    let s_date = p.s_date;
    if (p.g_sdate && s_date === p.g_sdate) {
      // VFP adjusts SDT by -1 day when equal to G_SDATE — client may pass pre-adjusted date
    }
    const sql = `
      SELECT A.CODE, B.NAME, B.PAN, B.TIN, B.ADD1, B.ADD2, B.ADD3, B.CITY, A.VR_TYPE,
        SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS AMOUNT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND A.CODE IN (SELECT MAX(C.CODE) FROM SALE C WHERE A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE)
      GROUP BY A.CODE, B.NAME, B.PAN, B.TIN, B.ADD1, B.ADD2, B.ADD3, B.CITY, A.VR_TYPE`;
    const x1 = await q(sql, { comp_code, s_date, e_date: p.e_date }, comp_uid);
    const map = new Map();
    for (const r of x1) {
      const gk = [r.CODE, r.NAME, r.PAN, r.TIN, r.ADD1, r.ADD2, r.ADD3, r.CITY].join('\0');
      if (!map.has(gk)) {
        map.set(gk, {
          CODE: r.CODE, NAME: r.NAME, PAN: r.PAN, TIN: r.TIN, ADD1: r.ADD1, ADD2: r.ADD2, ADD3: r.ADD3, CITY: r.CITY,
          OP_AMT: 0, SL_AMT: 0, CN_AMT: 0, CASH_RECEIPT: 0, BANK_RECEIPT: 0, JOURNAL_ADJ: 0,
        });
      }
      const row = map.get(gk);
      const vt = String(r.VR_TYPE || '').toUpperCase();
      const amt = num(r.AMOUNT);
      if (vt === 'OP') row.OP_AMT += amt;
      else if (['SL', 'ST', 'KV', 'SE'].includes(vt)) row.SL_AMT += amt;
      else if (vt === 'CN') row.CN_AMT += amt;
      else if (vt === 'CV') row.CASH_RECEIPT += amt;
      else if (vt === 'BV') row.BANK_RECEIPT += amt;
      else if (vt === 'JV') row.JOURNAL_ADJ += amt;
    }
    const receiptDisplay = (raw) => {
      const n = num(raw);
      return n !== 0 ? -n : 0;
    };
    let rows = [...map.values()].map((r) => ({
      CODE: r.CODE,
      NAME: r.NAME,
      PAN: r.PAN,
      TIN: r.TIN,
      ADD1: r.ADD1,
      ADD2: r.ADD2,
      ADD3: r.ADD3,
      CITY: r.CITY,
      OPENING: r.OP_AMT,
      SALE_AMOUNT: r.SL_AMT,
      CN_AMOUNT: r.CN_AMT,
      CASH_RECEIPT: receiptDisplay(r.CASH_RECEIPT),
      BANK_RECEIPT: receiptDisplay(r.BANK_RECEIPT),
      JOURNAL_ADJ: receiptDisplay(r.JOURNAL_ADJ),
      CL_BAL:
        r.OP_AMT + r.SL_AMT + r.CASH_RECEIPT + r.BANK_RECEIPT + r.JOURNAL_ADJ - r.CN_AMT,
    }));
    rows.sort((a, b) => String(a.NAME ?? '').localeCompare(String(b.NAME ?? '')));
    rows = appendGrandTotalRow(rows, {
      labelKey: 'NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: [
        'OPENING', 'SALE_AMOUNT', 'CN_AMOUNT', 'CASH_RECEIPT', 'BANK_RECEIPT', 'JOURNAL_ADJ', 'CL_BAL',
      ],
    });
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runItmSaleDet(comp_code, comp_uid, p) {
    const sqlSale = `
      SELECT A.TYPE, A.ITEM_CODE, B.ITEM_NAME,
        SUM(NVL(A.WEIGHT, 0) - (NVL(A.DANE_WGT, 0) + NVL(A.PAPLOO3, 0))) AS WEIGHT,
        SUM(NVL(A.AMOUNT, 0) - (NVL(A.P_AMT1, 0) + NVL(A.P_AMT2, 0) + NVL(A.P_AMT3, 0) + NVL(A.P_AMT4, 0) + NVL(A.P_AMT5, 0) + NVL(A.DANE_AMT, 0) + NVL(A.S_EXP1, 0) + NVL(A.S_EXP2, 0) + NVL(A.S_EXP3, 0))) AS AMOUNT,
        SUM(NVL(A.QNTY, 0)) AS QNTY,
        SUM(CASE WHEN NVL(A.BROKERAGE, 0) <> 0 THEN NVL(A.COMMISSION, 0) + NVL(A.BROKERAGE, 0) ELSE NVL(A.COMMISSION, 0) END) AS S_COMM
      FROM SALE A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND A.TYPE IN ('SL', 'CN', 'SE')
      GROUP BY A.TYPE, A.ITEM_CODE, B.ITEM_NAME`;
    const sqlSv = `
      SELECT 'SV' AS TYPE, A.ITEM_CODE, B.ITEM_NAME,
        SUM(NVL(A.WEIGHT, 0)) AS WEIGHT,
        SUM(NVL(A.AMOUNT, 0) - (NVL(A.OTH_EXP1, 0) + NVL(A.OTH_EXP2, 0) + NVL(A.OTH_EXP3, 0) + NVL(A.OTH_EXP4, 0) + NVL(A.OTH_EXP5, 0) + NVL(A.OTH_EXP6, 0))) AS AMOUNT,
        SUM(NVL(A.QNTY, 0)) AS QNTY, 0 AS S_COMM
      FROM DBIKRI A
      INNER JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.SV_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY')
      GROUP BY A.ITEM_CODE, B.ITEM_NAME`;
    const binds = { comp_code, s_date: p.s_date, e_date: p.e_date };
    const merged = [...(await q(sqlSale, binds, comp_uid)), ...(await q(sqlSv, binds, comp_uid))].map((r) => ({
      TYPE: r.TYPE,
      ITEM_CODE: r.ITEM_CODE,
      ITEM_NAME: r.ITEM_NAME,
      S_QTY: num(r.QNTY),
      S_WGT: num(r.WEIGHT),
      S_AMT: num(r.AMOUNT),
      S_COMM: num(r.S_COMM),
    }));
    const detail = groupSaleCn(merged, ['ITEM_CODE', 'ITEM_NAME'], ['S_QTY', 'S_WGT', 'S_AMT', 'S_COMM']);
    detail.sort((a, b) => {
      const byName = String(a.ITEM_NAME ?? '').localeCompare(String(b.ITEM_NAME ?? ''));
      if (byName !== 0) return byName;
      return String(a.ITEM_CODE ?? '').localeCompare(String(b.ITEM_CODE ?? ''), undefined, { numeric: true });
    });
    const rows = appendGrandTotalRow(detail, {
      labelKey: 'ITEM_NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['S_QTY', 'S_WGT', 'S_AMT', 'S_COMM'],
    });
    return { rows, columns: inferColumnsFromRows(detail) };
  }

  async function runLedgerDcCode(comp_code, comp_uid, p) {
    const scode = String(p.scode || '').trim();
    const schedule_no = scheduleFilter(p.schedule_no);
    let sql;
    const binds = { comp_code, e_date: p.e_date };
    if (scode) {
      sql = `
        SELECT A.CODE, B.NAME, B.SCHEDULE, A.DC_CODE, C.NAME AS DC_NAME,
          MAX(C.ADD1) AS ADD1, MAX(C.ADD2) AS ADD2, MAX(C.CITY) AS CITY,
          MAX(C.PAN) AS PAN, MAX(C.GST_NO) AS GST_NO,
          SUM(NVL(A.DR_AMT, 0)) AS DR_AMT, SUM(NVL(A.CR_AMT, 0)) AS CR_AMT
        FROM LEDGER A
        INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.DC_CODE = C.CODE
        WHERE A.COMP_CODE = :comp_code AND A.CODE = :scode
          AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY') AND NVL(A.BIKRI, 'X') <> 'Y'
        GROUP BY A.CODE, B.NAME, B.SCHEDULE, A.DC_CODE, C.NAME
        ORDER BY CODE, NAME, DC_NAME`;
      binds.scode = scode;
    } else {
      if (!schedule_no) throw new Error('ledger-dccode-report requires scode or schedule_no');
      sql = `
        SELECT A.CODE, B.NAME, B.SCHEDULE, A.DC_CODE, C.NAME AS DC_NAME,
          MAX(C.ADD1) AS ADD1, MAX(C.ADD2) AS ADD2, MAX(C.CITY) AS CITY,
          MAX(C.PAN) AS PAN, MAX(C.GST_NO) AS GST_NO,
          SUM(NVL(A.DR_AMT, 0)) AS DR_AMT, SUM(NVL(A.CR_AMT, 0)) AS CR_AMT
        FROM LEDGER A
        INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.DC_CODE = C.CODE
        WHERE A.COMP_CODE = :comp_code AND B.SCHEDULE = :schedule_no
          AND A.VR_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY') AND NVL(A.BIKRI, 'X') <> 'Y'
        GROUP BY A.CODE, B.NAME, B.SCHEDULE, A.DC_CODE, C.NAME
        ORDER BY CODE, NAME, DC_NAME`;
      binds.schedule_no = schedule_no;
    }
    let rows = await q(sql, binds, comp_uid);
    const mdc = p.mdc;
    if (mdc === 'D') rows = rows.filter((r) => num(r.DR_AMT) !== 0);
    else if (mdc === 'C') rows = rows.filter((r) => num(r.CR_AMT) !== 0);
    if (p.mru === 'R') rows = rows.filter((r) => String(r.GST_NO || '').trim() !== '');
    else if (p.mru === 'U') rows = rows.filter((r) => String(r.GST_NO || '').trim() === '');
    rows = appendGrandTotalRow(rows, {
      labelKey: 'DC_CODE',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['DR_AMT', 'CR_AMT'],
    });
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runPartyPurDet(comp_code, comp_uid, p) {
    const sql = `
      WITH TMP_PUR AS (
        SELECT COMP_CODE, CODE FROM PURCHASE GROUP BY COMP_CODE, CODE
        UNION
        SELECT COMP_CODE, SUP_CODE AS CODE FROM CPUR GROUP BY COMP_CODE, SUP_CODE
      )
      SELECT A.CODE, B.NAME, B.PAN, B.TIN, B.ADD1, B.ADD2, B.ADD3, B.CITY, A.VR_TYPE,
        SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
        SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE = 'PU' THEN 0 ELSE NVL(A.DR_AMT, 0) END) AS DR_AMT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND NVL(A.BIKRI, 'N') <> 'Y'
        AND A.VR_TYPE IN ('PU', 'DN', 'DX', 'CV', 'BV', 'JV', 'EV')
        AND EXISTS (SELECT 1 FROM TMP_PUR C WHERE A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE)
      GROUP BY A.CODE, B.NAME, B.PAN, B.TIN, B.ADD1, B.ADD2, B.ADD3, B.CITY, A.VR_TYPE`;
    const x1 = (await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid)).map((r) => ({
      ...r,
      AMOUNT: num(r.CR_AMT) - num(r.DR_AMT),
    }));
    const map = new Map();
    for (const r of x1) {
      const gk = [r.CODE, r.NAME, r.PAN, r.TIN, r.ADD1, r.ADD2, r.ADD3, r.CITY].join('\0');
      if (!map.has(gk)) {
        map.set(gk, {
          CODE: r.CODE, NAME: r.NAME, PAN: r.PAN, TIN: r.TIN, ADD1: r.ADD1, ADD2: r.ADD2, ADD3: r.ADD3, CITY: r.CITY,
          OP_AMT: 0, PUR_AMT: 0, DN_AMT: 0, CASH_PAYMENT: 0, BANK_PAYMENT: 0, JOURNAL: 0,
        });
      }
      const row = map.get(gk);
      const vt = String(r.VR_TYPE || '').toUpperCase();
      const amt = num(r.AMOUNT);
      if (vt === 'OP') row.OP_AMT += amt;
      else if (['PU', 'SV'].includes(vt)) row.PUR_AMT += amt;
      else if (['DN', 'DX'].includes(vt)) row.DN_AMT += amt;
      else if (vt === 'CV') row.CASH_PAYMENT += amt;
      else if (vt === 'BV') row.BANK_PAYMENT += amt;
      else if (['JV', 'EV', 'TV'].includes(vt)) row.JOURNAL += amt;
    }
    const paymentDisplay = (raw) => {
      const n = num(raw);
      return n !== 0 ? -n : 0;
    };
    let rows = [...map.values()].map((r) => ({
      CODE: r.CODE,
      NAME: r.NAME,
      PAN: r.PAN,
      TIN: r.TIN,
      ADD1: r.ADD1,
      ADD2: r.ADD2,
      ADD3: r.ADD3,
      CITY: r.CITY,
      OPENING: r.OP_AMT,
      PUR_AMOUNT: r.PUR_AMT,
      DN_AMOUNT: r.DN_AMT,
      CASH_PAYMENT: paymentDisplay(r.CASH_PAYMENT),
      BANK_PAYMENT: paymentDisplay(r.BANK_PAYMENT),
      JOURNAL: paymentDisplay(r.JOURNAL),
      CL_BAL:
        r.OP_AMT + r.PUR_AMT + r.CASH_PAYMENT + r.BANK_PAYMENT + r.JOURNAL - r.DN_AMT,
    }));
    rows.sort((a, b) => String(a.NAME ?? '').localeCompare(String(b.NAME ?? '')));
    rows = appendGrandTotalRow(rows, {
      labelKey: 'NAME',
      labelValue: 'GRAND TOTAL',
      sumKeys: [
        'OPENING', 'PUR_AMOUNT', 'DN_AMOUNT', 'CASH_PAYMENT', 'BANK_PAYMENT', 'JOURNAL', 'CL_BAL',
      ],
    });
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runCashflowMonthly(comp_code, comp_uid, p) {
    const mcode = String(p.mcode || '').trim().toUpperCase();
    if (!mcode) throw new Error('cash-movement-monthly requires mcode (cash account code)');
    const spNo = scheduleFilter(p.sp_no);
    const panYn = String(p.pan_yn || '').trim().toUpperCase();
    const cpMatchSql = `
      (
        :sp_no = 0 OR ROUND(NVL(B.SCHEDULE, 0), 2) = :sp_no
      )
      AND (
        :pan_yn = 'A'
        OR (:pan_yn = 'Y' AND TRIM(NVL(B.PAN, '')) <> '')
        OR (:pan_yn = 'N' AND TRIM(NVL(B.PAN, '')) = '')
      )`;
    const binds = {
      comp_code,
      mcode,
      s_date: p.s_date,
      e_date: p.e_date,
      sp_no: spNo,
      pan_yn: panYn === 'Y' || panYn === 'N' ? panYn : 'A',
    };
    const opSql = `
      SELECT SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) AS OPBAL
      FROM LEDGER A
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.CODE) = TRIM(:mcode)
        AND A.VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')`;
    const opRow = (await q(opSql, { comp_code, mcode, s_date: p.s_date }, comp_uid))[0];
    let opBal = num(opRow?.OPBAL);
    const sql = `
      SELECT TO_CHAR(A.VR_DATE, 'MON') AS MTH, TO_CHAR(A.VR_DATE, 'YYYY') AS YR, TO_CHAR(A.VR_DATE, 'MM') AS MM,
        SUM(CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND ${cpMatchSql} THEN NVL(A.DR_AMT, 0) ELSE 0 END) AS CASH_ADD,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND B.SCHEDULE >= 9 AND B.SCHEDULE < 10 AND ${cpMatchSql} THEN NVL(A.CR_AMT, 0) ELSE 0 END) AS BANK_DEP,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND B.SCHEDULE >= 15 AND ${cpMatchSql} THEN NVL(A.CR_AMT, 0) ELSE 0 END) AS CASH_EXP,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND B.SCHEDULE >= 1 AND B.SCHEDULE < 3 AND ${cpMatchSql} THEN NVL(A.CR_AMT, 0) ELSE 0 END) AS CASH_DRAW,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND B.SCHEDULE >= 5 AND B.SCHEDULE < 6 AND ${cpMatchSql} THEN NVL(A.CR_AMT, 0) ELSE 0 END) AS CASH_PUR,
        SUM(CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND ${cpMatchSql} THEN NVL(A.CR_AMT, 0) ELSE 0 END) AS CASH_OTHERS,
        SUM(CASE WHEN ${cpMatchSql} THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS CL_BAL
      FROM LEDGER A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.DC_CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.CODE) = TRIM(:mcode)
        AND ${betweenDatesSql('A.VR_DATE')}
      GROUP BY TO_CHAR(A.VR_DATE, 'MON'), TO_CHAR(A.VR_DATE, 'YYYY'), TO_CHAR(A.VR_DATE, 'MM')
      ORDER BY YR, MM`;
    const raw = await q(sql, binds, comp_uid);
    const rows = raw.map((r) => {
      const bankDep = num(r.BANK_DEP);
      const cashExp = num(r.CASH_EXP);
      const cashPur = num(r.CASH_PUR);
      const cashDraw = num(r.CASH_DRAW);
      let cashOth = num(r.CASH_OTHERS) - (bankDep + cashExp + cashPur + cashDraw);
      const cashAdd = num(r.CASH_ADD);
      const clBal = opBal + cashAdd - (bankDep + cashExp + cashPur + cashDraw + cashOth);
      const mth = String(r.MTH ?? '').trim();
      const yr = String(r.YR ?? '').trim();
      const out = {
        MONTH: [mth, yr].filter(Boolean).join(' '),
        MTH: mth,
        YR: yr,
        MM: r.MM,
        OP_BAL: opBal,
        CASH_ADD: cashAdd,
        BANK_DEP: bankDep,
        CASH_EXP: cashExp,
        CASH_PUR: cashPur,
        CASH_DRAW: cashDraw,
        CASH_OTH: cashOth,
        CL_BAL: clBal,
      };
      opBal = clBal;
      return out;
    });
    if (rows.length) {
      rows.push({
        MONTH: 'TOTAL',
        MTH: '',
        YR: '',
        MM: '',
        OP_BAL: rows[0].OP_BAL,
        CASH_ADD: rows.reduce((s, r) => s + num(r.CASH_ADD), 0),
        BANK_DEP: rows.reduce((s, r) => s + num(r.BANK_DEP), 0),
        CASH_EXP: rows.reduce((s, r) => s + num(r.CASH_EXP), 0),
        CASH_PUR: rows.reduce((s, r) => s + num(r.CASH_PUR), 0),
        CASH_DRAW: rows.reduce((s, r) => s + num(r.CASH_DRAW), 0),
        CASH_OTH: rows.reduce((s, r) => s + num(r.CASH_OTH), 0),
        CL_BAL: rows[rows.length - 1].CL_BAL,
        _isGrandTotal: true,
      });
    }
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runExpensesMonthly(comp_code, comp_uid, p) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'month') {
      return runExpensesMonthlyDetail(comp_code, comp_uid, p);
    }
    const sql = `
      SELECT EXTRACT(MONTH FROM A.VR_DATE) AS MTH, TO_CHAR(A.VR_DATE, 'MONTH') AS CMTH,
        EXTRACT(YEAR FROM A.VR_DATE) AS MYEAR,
        SUM(CASE WHEN A.VR_TYPE = 'CV' THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS CASH_EXP,
        SUM(CASE WHEN A.VR_TYPE <> 'CV' THEN NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) ELSE 0 END) AS NON_CASH_EXP
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND B.SCHEDULE >= 15.1
        AND ${betweenDatesSql('A.VR_DATE')}
      GROUP BY EXTRACT(MONTH FROM A.VR_DATE), TO_CHAR(A.VR_DATE, 'MONTH'), EXTRACT(YEAR FROM A.VR_DATE)
      ORDER BY MYEAR, MTH`;
    const raw = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const rows = pivotExpensesMonthly(raw);
    const columns = cols(['HEAD_NAME', ...FISCAL_MONTHS.map((m) => m.key), 'TOT']);
    return { rows, columns };
  }

  async function runExpensesMonthlyDetail(comp_code, comp_uid, p) {
    const monthKey = String(p.month_key || '').trim().toUpperCase();
    const expType = String(p.exp_type || '').trim().toLowerCase();
    const cal = fiscalMonthCalendar(p.s_date, p.e_date, monthKey);
    if (!cal) throw new Error('Invalid month for expense detail');
    if (expType !== 'cash' && expType !== 'noncash') {
      throw new Error('exp_type must be cash or noncash');
    }
    const cashFilter =
      expType === 'cash'
        ? `TRIM(NVL(A.VR_TYPE, '')) = 'CV'`
        : `TRIM(NVL(A.VR_TYPE, '')) <> 'CV'`;
    const sql = `
      SELECT TRIM(A.CODE) AS CODE, B.NAME,
        A.VR_DATE,
        NVL(A.VR_NO, 0) AS VR_NO,
        TRIM(NVL(A.VR_TYPE, '')) AS VR_TYPE,
        NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0) AS AMOUNT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND B.SCHEDULE >= 15.1
        AND ${betweenDatesSql('A.VR_DATE')}
        AND EXTRACT(MONTH FROM A.VR_DATE) = :mth
        AND EXTRACT(YEAR FROM A.VR_DATE) = :myear
        AND ${cashFilter}
        AND (NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0)) <> 0
      ORDER BY TRIM(A.CODE), A.VR_DATE, A.VR_NO, A.VR_TYPE`;
    const raw = await q(
      sql,
      {
        comp_code,
        s_date: p.s_date,
        e_date: p.e_date,
        mth: cal.mth,
        myear: cal.myear,
      },
      comp_uid
    );
    let rows = raw.map((r) => ({ ...r, AMOUNT: num(r.AMOUNT) }));
    rows = appendGrandTotalRow(rows, {
      labelKey: 'VR_DATE',
      labelValue: 'GRAND TOTAL',
      sumKeys: ['AMOUNT'],
    });
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runCustPmt(comp_code, comp_uid, p, mds) {
    const sql = `
      SELECT A.CODE, B.NAME, B.PAN, B.GST_NO, B.ADD1, B.ADD2, B.ADD3, B.CITY,
        A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.VR_TYPE,
        CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE <> 'JV' THEN A.DR_AMT ELSE 0 END AS SALE_AMT,
        CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND A.VR_TYPE = 'CV' THEN A.CR_AMT ELSE 0 END AS CASH_PMT,
        CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND A.VR_TYPE = 'BV' THEN A.CR_AMT ELSE 0 END AS BANK_PMT,
        CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND A.VR_TYPE = 'JV' THEN A.CR_AMT ELSE 0 END AS JOU_PMT,
        CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND A.VR_TYPE = 'CN' THEN A.CR_AMT ELSE 0 END AS CN_AMT,
        CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE = 'JV' THEN A.DR_AMT ELSE 0 END AS JOU_INT
      FROM BILLS A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND ${betweenDatesSql('A.VR_DATE')}
        AND B.SCHEDULE > 8 AND B.SCHEDULE < 9
      ORDER BY CODE, BILL_DATE, BILL_NO, B_TYPE`;
    const x1 = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const x2map = new Map();
    for (const r of x1) {
      const gk = [r.CODE, r.NAME, r.PAN, r.GST_NO, r.ADD1, r.ADD2, r.ADD3, r.CITY, r.BILL_DATE, r.BILL_NO, r.B_TYPE].join('\0');
      if (!x2map.has(gk)) {
        x2map.set(gk, {
          CODE: r.CODE, NAME: r.NAME, PAN: r.PAN, GST_NO: r.GST_NO, ADD1: r.ADD1, ADD2: r.ADD2, ADD3: r.ADD3, CITY: r.CITY,
          BILL_DATE: r.BILL_DATE, BILL_NO: r.BILL_NO, B_TYPE: r.B_TYPE,
          BILL_AMT: 0, RET_AMT: 0, INT_AMT: 0, CASH_PMT: 0, CHQ_PMT: 0, OTHERS: 0,
        });
      }
      const row = x2map.get(gk);
      row.BILL_AMT += num(r.SALE_AMT);
      row.RET_AMT += num(r.CN_AMT);
      row.INT_AMT += num(r.JOU_INT);
      row.CASH_PMT += num(r.CASH_PMT);
      row.CHQ_PMT += num(r.BANK_PMT);
      row.OTHERS += num(r.JOU_PMT);
    }
    let rows = [...x2map.values()].map((r) => ({
      ...r,
      NET_AMT: num(r.BILL_AMT) - num(r.RET_AMT),
    }));
    if (mds === 2) {
      const smap = new Map();
      for (const r of rows) {
        const gk = [r.CODE, r.NAME, r.PAN, r.GST_NO, r.ADD1, r.ADD2, r.ADD3, r.CITY].join('\0');
        if (!smap.has(gk)) {
          smap.set(gk, {
            CODE: r.CODE, NAME: r.NAME, PAN: r.PAN, GST_NO: r.GST_NO, ADD1: r.ADD1, ADD2: r.ADD2, ADD3: r.ADD3, CITY: r.CITY,
            BILL_AMT: 0, RET_AMT: 0, INT_AMT: 0, CASH_PMT: 0, CHQ_PMT: 0, OTHERS: 0,
          });
        }
        const s = smap.get(gk);
        s.BILL_AMT += num(r.BILL_AMT);
        s.RET_AMT += num(r.RET_AMT);
        s.INT_AMT += num(r.INT_AMT);
        s.CASH_PMT += num(r.CASH_PMT);
        s.CHQ_PMT += num(r.CHQ_PMT);
        s.OTHERS += num(r.OTHERS);
      }
      rows = [...smap.values()].map((r) => ({ ...r, NET_AMT: num(r.BILL_AMT) - num(r.RET_AMT) }));
    }
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runSupPmt(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.CODE, B.NAME, B.PAN, B.GST_NO, B.ADD1, B.ADD2, B.ADD3, B.CITY,
        A.BILL_DATE, A.BILL_NO, A.VR_TYPE,
        CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND A.VR_TYPE <> 'JV' THEN A.CR_AMT ELSE 0 END AS PUR_AMT,
        CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE = 'CV' THEN A.DR_AMT ELSE 0 END AS CASH_PMT,
        CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE = 'BV' THEN A.DR_AMT ELSE 0 END AS BANK_PMT,
        CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE = 'JV' THEN A.DR_AMT ELSE 0 END AS JOU_PMT,
        CASE WHEN NVL(A.DR_AMT, 0) <> 0 AND A.VR_TYPE = 'DN' THEN A.DR_AMT ELSE 0 END AS CN_AMT,
        CASE WHEN NVL(A.CR_AMT, 0) <> 0 AND A.VR_TYPE = 'JV' THEN A.CR_AMT ELSE 0 END AS JOU_INT
      FROM BILLS A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND ${betweenDatesSql('A.VR_DATE')}
        AND B.SCHEDULE > 11 AND B.SCHEDULE < 12
      ORDER BY B.NAME, A.CODE, A.BILL_DATE, A.BILL_NO`;
    const x1 = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    const map = new Map();
    for (const r of x1) {
      const gk = [r.CODE, r.NAME, r.PAN, r.GST_NO, r.ADD1, r.ADD2, r.ADD3, r.CITY, r.BILL_DATE, r.BILL_NO].join('\0');
      if (!map.has(gk)) {
        map.set(gk, {
          CODE: r.CODE, NAME: r.NAME, PAN: r.PAN, GST_NO: r.GST_NO, ADD1: r.ADD1, ADD2: r.ADD2, ADD3: r.ADD3, CITY: r.CITY,
          BILL_DATE: r.BILL_DATE, BILL_NO: r.BILL_NO,
          BILL_AMT: 0, RET_AMT: 0, INT_AMT: 0, CASH_PMT: 0, CHQ_PMT: 0, OTHERS: 0,
        });
      }
      const row = map.get(gk);
      row.BILL_AMT += num(r.PUR_AMT);
      row.RET_AMT += num(r.CN_AMT);
      row.INT_AMT += num(r.JOU_INT);
      row.CASH_PMT += num(r.CASH_PMT);
      row.CHQ_PMT += num(r.BANK_PMT);
      row.OTHERS += num(r.JOU_PMT);
    }
    const rows = [...map.values()].map((r) => ({ ...r, NET_AMT: num(r.BILL_AMT) - num(r.RET_AMT) }));
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runBrokSale(comp_code, comp_uid, p) {
    const bk_code = String(p.bk_code || '').trim();
    const sql = `
      SELECT A.BK_CODE, B.NAME AS BK_NAME, A.CODE, C.NAME, C.STATE_CODE, C.STATE, C.CITY,
        SUM(CASE WHEN A.TYPE = 'CN' THEN A.QNTY * -1 ELSE A.QNTY END) AS QNTY,
        SUM(CASE WHEN A.TYPE = 'CN' THEN A.WEIGHT * -1 ELSE A.WEIGHT END) AS WEIGHT,
        SUM(CASE WHEN A.TYPE = 'CN' THEN A.BILL_AMT * -1 ELSE A.BILL_AMT END) AS AMOUNT
      FROM SALE A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.BK_CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${billBetweenDatesSql('A.BILL_DATE')}
        AND (:bk_code IS NULL OR :bk_code = '' OR A.BK_CODE = :bk_code)
      GROUP BY A.BK_CODE, B.NAME, A.CODE, C.NAME, C.STATE_CODE, C.STATE, C.CITY
      ORDER BY B.NAME, A.BK_CODE, C.STATE_CODE, C.CITY, C.NAME, A.CODE`;
    const rows = await q(sql, {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      bk_code: bk_code || null,
    }, comp_uid);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  const HANDLERS = {
    'loaner-list': (cc, cu, p) => runLoanerList(cc, cu, p),
    'broker-list': (cc, cu, p) => runDalaliRpt(cc, cu, p),
    'party-wise-purchase': (cc, cu, p) => runItaxPur(cc, cu, p),
    'party-wise-sales': (cc, cu, p) => runItaxSale(cc, cu, p),
    'top-party-sales': (cc, cu, p) => runItaxTopPartySale(cc, cu, p),
    'month-schedule-wise-list': (cc, cu, p) => runItaxSch(cc, cu, p),
    'customer-arhat': (cc, cu, p) => runItaxArh(cc, cu, p),
    'dami-wise-sales': (cc, cu, p) => runDamiWiseSales(cc, cu, p),
    'monthly-purchase-report': (cc, cu, p) => runPurRpt(cc, cu, p),
    'monthly-sales-report': (cc, cu, p) => runSaleRpt1(cc, cu, p),
    'item-wise-purchase-sale': (cc, cu, p) => runItmSalPur(cc, cu, p),
    'item-wise-sales-dami': (cc, cu, p) => runItmSale(cc, cu, p),
    'party-wise-purchase-bill': (cc, cu, p) => runItaxPurBill(cc, cu, p),
    'party-wise-sale-bill': (cc, cu, p) => runItaxSaleBill(cc, cu, p),
    'party-wise-purchase-item': (cc, cu, p) => runItaxPurItem(cc, cu, p),
    'party-wise-sale-item': (cc, cu, p) => runItaxSaleItem(cc, cu, p),
    'item-wise-sales-party': (cc, cu, p) => runItaxItemSale(cc, cu, p),
    'party-wise-sale-month': (cc, cu, p) => runItaxSaleMth(cc, cu, p),
    'item-wise-sale-month-party': (cc, cu, p) => runItaxSaleItemMth(cc, cu, p),
    'supplier-sales-customer-wise': (cc, cu, p) => runItaxSaleCust(cc, cu, p),
    'lot-wise-purchase-sale': (cc, cu, p) => runLotPurSale(cc, cu, p),
    'item-wise-purchase': (cc, cu, p) => runItaxItemPur(cc, cu, p),
    'item-wise-purchase-monthly': (cc, cu, p) => runItaxPurItemMth(cc, cu, p),
    'party-wise-sale-tdg-consg': (cc, cu, p) => runPsaleNew(cc, cu, p),
    'sale-above-amount': (cc, cu, p) => runItaxSale(cc, cu, p, { forceMinAmt: p.min_amt }),
    'sale-detail-excel': (cc, cu, p) => runPartySaleDet(cc, cu, p),
    'item-wise-sales-detail': (cc, cu, p) => runItmSaleDet(cc, cu, p),
    'ledger-dccode-report': (cc, cu, p) => runLedgerDcCode(cc, cu, p),
    'purchase-detail-excel': (cc, cu, p) => runPartyPurDet(cc, cu, p),
    'cash-movement-monthly': (cc, cu, p) => runCashflowMonthly(cc, cu, p),
    'monthly-cash-noncash-exp': (cc, cu, p) => runExpensesMonthly(cc, cu, p),
    'customer-bill-payment-detail': (cc, cu, p) => runCustPmt(cc, cu, p, 1),
    'customer-bill-payment-summary': (cc, cu, p) => runCustPmt(cc, cu, p, 2),
    'broker-station-wise-sales': (cc, cu, p) => runBrokSale(cc, cu, p),
    'supplier-bill-payment-detail': (cc, cu, p) => runSupPmt(cc, cu, p),
  };

  async function buildIncomeTaxReport(reportId, comp_code, comp_uid, params = {}) {
    const id = String(reportId || '').trim().toLowerCase();
    const handler = HANDLERS[id];
    if (!handler) {
      throw new Error(
        `Unknown income tax report id: "${reportId}". Valid ids: ${REPORT_IDS.join(', ')}`
      );
    }
    const cc = String(comp_code ?? '').trim();
    if (!cc) throw new Error('comp_code is required');
    if (comp_uid == null) throw new Error('comp_uid is required');
    const p = normalizeParams(params);
    const result = await handler(cc, comp_uid, p);
    const rows = result.rows ?? [];
    const columns = result.columns ?? inferColumnsFromRows(rows);
    return { rows, columns };
  }

  return { buildIncomeTaxReport };
}

module.exports = {
  createIncomeTaxReports,
  inferColumnsFromRows,
  humanizeColumnKey,
  REPORT_IDS,
};
