/**
 * Other Reports — ported from VFP prg (labour, broker, insrpt, ledger, chant, etc.)
 * Factory: createOtherReports(runQuery) → { buildOtherReport }
 */

'use strict';

const { inferColumnsFromRows, humanizeColumnKey } = require('./incomeTaxReports.cjs');

const REPORT_IDS = [
  'labour-report',
  'brokerage-date-wise',
  'brokerage-item-wise',
  'insurance-report',
  'brokerage-item-cat-wise',
  'broker-summary',
  'trading-exp',
  'broker-ledger',
  'broker-trial',
  'paploo-report',
  'brokerage-purchase',
  'voucher-adv-payment-revd',
  'chant-format-1',
  'chant-format-2',
  'chant-format-3',
  'chant-summary',
  'broker-wise-scheme',
  'broker-dalali-less-freight',
  'freight-party-ledger',
  'indent-party-ledger',
  'purchase-outstanding-month',
  'sale-outstanding-month',
  'dalali-excel',
  'combined-sale-purchase',
];

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
  return {
    s_date: pick('s_date', 'sdt', 'SDT', 'S_DATE'),
    e_date: pick('e_date', 'edt', 'EDT', 'E_DATE'),
    cs_date: pick('cs_date', 'csdt', 'CSDT'),
    ce_date: pick('ce_date', 'cedt', 'CEDT'),
    scode: pick('scode', 'sup_code', 'SUP_CODE'),
    mcode: pick('mcode', 'party_code', 'MCODE', 'CODE'),
    icode: pickNum('icode', 'item_code', 'ITEM_CODE'),
    sb_code: pick('sb_code', 'sbCode', 'SBCODE') || 'B00000',
    eb_code: pick('eb_code', 'ebCode', 'EBCODE') || 'B99999',
    msp: (pick('msp', 'MSP') || 'S').toUpperCase(),
    icat: pick('icat', 'ICAT', 'item_cat'),
    mlc: pick('mlc', 'MLC'),
    mds: (pick('mds', 'MDS') || 'D').toUpperCase(),
    rptype: pickNum('rptype', 'RTYPE'),
    rpttype: pick('rpttype', 'RPTTYPE'),
    mcn: pick('mcn', 'MCN'),
    btype: pick('btype', 'BTYPE'),
    god_code: pick('god_code', 'godCode', 'GOD_CODE'),
    m_sup_code: pick('m_sup_code', 'mSupCode', 'M_SUP_CODE'),
    ledger_type: pick('ledger_type', 'LEGTYPE', 'mcp', 'MCP') || 'C',
    detail_mode: pick('detail_mode', 'DETAIL_MODE'),
    detail_date: pick('detail_date', 'DETAIL_DATE'),
    detail_month: pick('detail_month', 'DETAIL_MONTH', 'month_key', 'MONTH_KEY'),
    detail_bk_code: pick('detail_bk_code', 'DETAIL_BK_CODE', 'bk_code', 'BK_CODE'),
    detail_item_code: pick('detail_item_code', 'DETAIL_ITEM_CODE', 'item_code', 'ITEM_CODE'),
    detail_item_name: pick('detail_item_name', 'DETAIL_ITEM_NAME', 'item_name', 'ITEM_NAME'),
  };
}

function betweenDatesSql(col) {
  return `${col} BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')`;
}

function billBetweenSql(col) {
  return `${col} BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')`;
}

function parseDateOnly(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }
  const s = String(raw).trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) {
      return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    return null;
  }
  const ymdOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymdOnly) return new Date(Number(ymdOnly[1]), Number(ymdOnly[2]) - 1, Number(ymdOnly[3]));
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function dateMapKey(raw) {
  const d = parseDateOnly(raw);
  if (!d) return String(raw ?? '');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function compareVrDate(a, b) {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.getTime() - db.getTime();
}

function monthStartOf(raw) {
  const d = parseDateOnly(raw);
  if (!d) return null;
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthKeyFromValue(raw) {
  const d = monthStartOf(raw);
  if (!d) return String(raw ?? '');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonthKey(mk) {
  const parts = String(mk).split('-');
  if (parts.length < 2) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  return new Date(y, m - 1, 1);
}

function addCalendarMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function enumerateCalendarMonths(from, to) {
  const start = monthStartOf(from);
  const end = monthStartOf(to);
  if (!start || !end || start > end) return [];
  const out = [];
  let cur = new Date(start.getTime());
  while (cur <= end) {
    out.push(new Date(cur.getTime()));
    cur = addCalendarMonths(cur, 1);
  }
  return out;
}

const CMTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatCmthLabel(d) {
  const m = monthStartOf(d);
  if (!m) return '';
  return `${CMTH_LABELS[m.getMonth()]}-${m.getFullYear()}`;
}

function labourSection(eType, lc) {
  const et = String(eType || '').trim();
  const l = String(lc || '').trim();
  if (et === 'S') return 'SALES';
  if (et === 'R' && l === 'L') return 'LOCAL';
  if (et === 'R' && l === 'C') return 'CENTRAL ARRIVAL';
  return '';
}

function labourLineAmt(line, exp) {
  const qnty = num(line.QNTY);
  const st = String(line.STATUS || '').trim();
  const et = String(line.E_TYPE || '').trim();
  const lb = num(exp.LABOUR_B) / 2 + num(exp.DALA_B);
  const lk = num(exp.LABOUR_K) / 2 + num(exp.DALA_K);
  const lh = num(exp.LABOUR_H) / 2 + num(exp.DALA_H);
  if (et === 'R') {
    if (st === 'B') return qnty * lb;
    if (st === 'K') return qnty * lk;
    if (st === 'H') return qnty * lh;
  } else if (et === 'S') {
    if (st === 'B') return qnty * (num(exp.LABOUR_B) / 2);
    if (st === 'K') return qnty * (num(exp.LABOUR_K) / 2);
    if (st === 'H') return qnty * (num(exp.LABOUR_H) / 2);
  }
  return 0;
}

function applyLabourLineToAgg(agg, line, exp) {
  const qnty = num(line.QNTY);
  const lc = String(line.L_C || '').trim();
  const st = String(line.STATUS || '').trim();
  const et = String(line.E_TYPE || '').trim();
  const lb = num(exp.LABOUR_B) / 2 + num(exp.DALA_B);
  const lk = num(exp.LABOUR_K) / 2 + num(exp.DALA_K);
  const lh = num(exp.LABOUR_H) / 2 + num(exp.DALA_H);
  if (et === 'R' && lc === 'L') {
    if (st === 'B') { agg.LRBAGS += qnty; agg.LRBAMT += qnty * lb; }
    if (st === 'K') { agg.LRKATA += qnty; agg.LRKAMT += qnty * lk; }
    if (st === 'H') { agg.LRHKAT += qnty; agg.LRHAMT += qnty * lh; }
  } else if (et === 'R' && lc === 'C') {
    if (st === 'B') { agg.CRBAGS += qnty; agg.CRBAMT += qnty * lb; }
    if (st === 'K') { agg.CRKATA += qnty; agg.CRKAMT += qnty * lk; }
    if (st === 'H') { agg.CRHKAT += qnty; agg.CRHAMT += qnty * lh; }
  } else if (et === 'S') {
    if (st === 'B') { agg.LSBAGS += qnty; agg.LSBAMT += qnty * (num(exp.LABOUR_B) / 2); }
    if (st === 'K') { agg.LSKATA += qnty; agg.LSKAMT += qnty * (num(exp.LABOUR_K) / 2); }
    if (st === 'H') { agg.LSHKAT += qnty; agg.LSHAMT += qnty * (num(exp.LABOUR_H) / 2); }
  }
}

function appendGrandTotal(rows, sumKeys, labelKey = 'NAME', labelValue = 'GRAND TOTAL') {
  if (!rows.length) return rows;
  const total = { [labelKey]: labelValue, _isGrandTotal: true };
  for (const k of sumKeys) {
    total[k] = rows.reduce((s, r) => s + num(r[k]), 0);
  }
  return [...rows, total];
}

function applySaleCn(row) {
  const isCn = String(row.TYPE || '').trim().toUpperCase() === 'CN';
  if (!isCn) return row;
  const out = { ...row };
  for (const k of ['QNTY', 'WEIGHT', 'AMOUNT', 'BROKERAGE', 'DANE_AMT', 'FREIGHT', 'P_AMT']) {
    if (out[k] != null) out[k] = num(out[k]) * -1;
  }
  return out;
}

function filterBrokerRows(rows, p) {
  let out = rows;
  if (p.scode) out = out.filter((r) => String(r.SUP_CODE || '').trim() === p.scode);
  if (p.mcode) out = out.filter((r) => String(r.CODE || '').trim() === p.mcode);
  if (p.icode) out = out.filter((r) => num(r.ITEM_CODE) === p.icode);
  if (p.icat) out = out.filter((r) => String(r.ITEM_CAT || '').trim() === p.icat);
  if (p.mlc) out = out.filter((r) => String(r.L_C || '').trim() === p.mlc);
  if (p.god_code) out = out.filter((r) => String(r.GOD_CODE || '').trim() === p.god_code);
  return out;
}

function createOtherReports(runQuery) {
  const q = (sql, binds, comp_uid) => runQuery(sql, binds, comp_uid).then(normalizeRows);

  async function fetchSaleBrokerRaw(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.*, B.NAME AS BNAME, B.L_C, C.ITEM_NAME, D.NAME
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.BK_CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      INNER JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.TYPE IN ('SL','CN')
        AND ${billBetweenSql('A.BILL_DATE')}
        AND A.BK_CODE BETWEEN :sb_code AND :eb_code
      ORDER BY B.NAME, A.BK_CODE, A.BILL_DATE, A.BILL_NO`;
    const rows = await q(sql, {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      sb_code: p.sb_code,
      eb_code: p.eb_code,
    }, comp_uid);
    return filterBrokerRows(rows.map(applySaleCn), p);
  }

  async function fetchPurchaseBrokerRaw(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.*, B.NAME AS BNAME, C.ITEM_NAME, D.NAME
      FROM PURCHASE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.B_CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      INNER JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${billBetweenSql('A.R_DATE')}
        AND A.B_CODE BETWEEN :sb_code AND :eb_code
      ORDER BY B.NAME, A.B_CODE, A.R_DATE, A.R_NO`;
    const rows = await q(sql, {
      comp_code,
      s_date: p.s_date,
      e_date: p.e_date,
      sb_code: p.sb_code,
      eb_code: p.eb_code,
    }, comp_uid);
    return filterBrokerRows(rows, p);
  }

  async function loadLabourFilteredLines(comp_code, comp_uid, p, detailDate = '') {
    const dateSql = detailDate
      ? `TRUNC(A.VR_DATE) = TO_DATE(:detail_date,'DD-MM-YYYY')`
      : betweenDatesSql('A.VR_DATE');
    const linesSql = `
      SELECT A.VR_DATE, A.VR_NO, A.VR_TYPE, A.E_TYPE, A.STATUS, A.QNTY, B.L_C, B.NAME AS SUP_NAME, A.SUP_CODE,
        A.EXP_CAT, A.B_NO, A.ITEM_CODE, I.ITEM_NAME, A.LOT
      FROM LOTSTOCK A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.SUP_CODE = B.CODE
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${dateSql}
        AND NVL(A.LABOUR,'Y') <> 'N'`;
    const expSql = `SELECT EXP_CAT, LABOUR_B, LABOUR_K, LABOUR_H, DALA_B, DALA_K, DALA_H FROM BIKEXP WHERE COMP_CODE = :comp_code`;
    const lotSql = `
      SELECT B_NO, ITEM_CODE, LOT, MAX(NVL(LABOUR,'Y')) LABOUR, MAX(NVL(EXP_CAT,'A')) EXP_CAT
      FROM LOTSTOCK
      WHERE COMP_CODE = :comp_code AND E_TYPE = 'R' AND VR_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
        AND NVL(LABOUR,'Y') <> 'N'
      GROUP BY B_NO, ITEM_CODE, LOT`;
    const binds = detailDate
      ? { comp_code, detail_date: detailDate }
      : { comp_code, s_date: p.s_date, e_date: p.e_date };
    const [lines, expRows, lotKeys] = await Promise.all([
      q(linesSql, binds, comp_uid),
      q(expSql, { comp_code }, comp_uid),
      q(lotSql, { comp_code, e_date: p.e_date }, comp_uid),
    ]);
    const expMap = Object.fromEntries(expRows.map((r) => [String(r.EXP_CAT || 'A'), r]));
    const lotSet = new Set(lotKeys.map((r) => `${r.B_NO}|${r.ITEM_CODE}|${r.LOT}`));
    const filtered = lines.filter((r) => lotSet.has(`${r.B_NO}|${r.ITEM_CODE}|${r.LOT}`));
    return { filtered, expMap };
  }

  async function runLabourDateDetail(comp_code, comp_uid, p) {
    const detailDate = String(p.detail_date || '').trim();
    if (!detailDate) {
      throw Object.assign(new Error('detail_date is required (DD-MM-YYYY)'), { status: 400 });
    }
    const { filtered, expMap } = await loadLabourFilteredLines(comp_code, comp_uid, p, detailDate);
    const sectionOrder = { LOCAL: 1, 'CENTRAL ARRIVAL': 2, SALES: 3 };
    const rows = filtered
      .map((r) => {
        const exp = expMap[String(r.EXP_CAT || 'A')] || {};
        const et = String(r.E_TYPE || '').trim().toUpperCase();
        const lc = String(r.L_C || '').trim();
        const qnty = num(r.QNTY);
        return {
          SECTION: labourSection(et, lc),
          E_TYPE: et,
          L_C: lc,
          STATUS: String(r.STATUS || '').trim(),
          R_QNTY: et === 'R' ? qnty : 0,
          S_QNTY: et === 'S' ? qnty : 0,
          LAB_AMT: labourLineAmt(r, exp),
          B_NO: r.B_NO,
          ITEM_CODE: r.ITEM_CODE,
          ITEM_NAME: r.ITEM_NAME,
          LOT: r.LOT,
          SUP_CODE: r.SUP_CODE,
          SUP_NAME: r.SUP_NAME,
          EXP_CAT: r.EXP_CAT,
          VR_NO: r.VR_NO,
          VR_TYPE: r.VR_TYPE,
        };
      })
      .sort((a, b) => {
        const sa = sectionOrder[a.SECTION] ?? 9;
        const sb = sectionOrder[b.SECTION] ?? 9;
        if (sa !== sb) return sa - sb;
        const byBno = String(a.B_NO ?? '').localeCompare(String(b.B_NO ?? ''));
        if (byBno !== 0) return byBno;
        return num(a.ITEM_CODE) - num(b.ITEM_CODE) || String(a.LOT ?? '').localeCompare(String(b.LOT ?? ''));
      });
    return {
      rows: appendGrandTotal(rows, ['R_QNTY', 'S_QNTY', 'LAB_AMT'], 'SECTION', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runLabour(comp_code, comp_uid, p) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'date') {
      return runLabourDateDetail(comp_code, comp_uid, p);
    }
    const { filtered, expMap } = await loadLabourFilteredLines(comp_code, comp_uid, p);
    const byDate = new Map();
    for (const r of filtered) {
      const d = r.VR_DATE;
      const key = dateMapKey(d);
      if (!byDate.has(key)) {
        byDate.set(key, { VR_DATE: d, LRBAGS: 0, LRKATA: 0, LRHKAT: 0, CRBAGS: 0, CRKATA: 0, CRHKAT: 0, LSBAGS: 0, LSKATA: 0, LSHKAT: 0,
          LRBAMT: 0, LRKAMT: 0, LRHAMT: 0, CRBAMT: 0, CRKAMT: 0, CRHAMT: 0, LSBAMT: 0, LSKAMT: 0, LSHAMT: 0 });
      }
      const agg = byDate.get(key);
      const exp = expMap[String(r.EXP_CAT || 'A')] || {};
      applyLabourLineToAgg(agg, r, exp);
    }
    const amtKeys = ['LRBAMT','LRKAMT','LRHAMT','CRBAMT','CRKAMT','CRHAMT','LSBAMT','LSKAMT','LSHAMT'];
    const rows = [...byDate.values()]
      .sort((a, b) => compareVrDate(a.VR_DATE, b.VR_DATE))
      .map((r) => ({
        ...r,
        TOT_AMT: amtKeys.reduce((s, k) => s + num(r[k]), 0),
      }));
    const sumKeys = ['LRBAGS','LRKATA','LRHKAT','CRBAGS','CRKATA','CRHKAT','LSBAGS','LSKATA','LSHKAT', ...amtKeys, 'TOT_AMT'];
    return { rows: appendGrandTotal(rows, sumKeys, 'VR_DATE', 'GRAND TOTAL'), columns: inferColumnsFromRows(rows) };
  }

  function mapBrokerItemWise(raw, purchase = false) {
    return raw.map((a) => ({
      BK_CODE: purchase ? a.B_CODE : a.BK_CODE,
      BNAME: a.BNAME,
      ITEM_CODE: a.ITEM_CODE,
      ITEM_NAME: a.ITEM_NAME,
      BILL_DATE: purchase ? a.R_DATE : a.BILL_DATE,
      BILL_NO: purchase ? a.R_NO : a.BILL_NO,
      CODE: a.CODE,
      NAME: a.NAME,
      STATUS: a.STATUS,
      QNTY: num(a.QNTY),
      WEIGHT: num(a.WEIGHT),
      RATE: num(a.RATE),
      AMOUNT: num(a.AMOUNT),
      BROK_PER: num(purchase ? a.BROK_RATE : a.BROK_PER),
      BROKERAGE: num(purchase ? a.BROK_AMT : a.BROKERAGE),
      DANE_AMT: num(a.DANE_AMT),
      P_AMT: purchase ? 0 : num(a.P_AMT1) + num(a.P_AMT2) + num(a.P_AMT3) + num(a.P_AMT5),
      ITEM_CAT: a.ITEM_CAT,
      L_C: a.L_C,
      SUP_CODE: purchase ? a.PUR_CODE : a.SUP_CODE,
    }));
  }

  function mapBrokerItemWiseRow(a, p) {
    const purchase = p.msp === 'P';
    const amount = num(a.AMOUNT) + (purchase ? 0 : num(a.FREIGHT));
    const qnty = num(a.QNTY);
    const brokerage = num(purchase ? a.BROK_AMT : a.BROKERAGE);
    const dane = num(a.DANE_AMT);
    const pAmt = purchase ? 0 : num(a.P_AMT1) + num(a.P_AMT2) + num(a.P_AMT3) + num(a.P_AMT5);
    return {
      BK_CODE: purchase ? a.B_CODE : a.BK_CODE,
      BNAME: a.BNAME,
      ITEM_CODE: a.ITEM_CODE,
      ITEM_NAME: a.ITEM_NAME,
      BILL_DATE: purchase ? a.R_DATE : a.BILL_DATE,
      BILL_NO: purchase ? a.R_NO : a.BILL_NO,
      TYPE: a.TYPE,
      B_TYPE: a.B_TYPE,
      CODE: a.CODE,
      NAME: a.NAME,
      BAGS: String(a.STATUS) === 'B' ? qnty : 0,
      KATTA: String(a.STATUS) === 'K' ? qnty : 0,
      HKATTA: String(a.STATUS) === 'H' ? qnty : 0,
      RATE: num(a.RATE),
      WEIGHT: num(a.WEIGHT),
      AMOUNT: amount,
      BROK_PER: num(purchase ? a.BROK_RATE : a.BROK_PER),
      FREIGHT: num(a.FREIGHT),
      BROKERAGE: brokerage,
      DANE_AMT: dane,
      P_AMT: pAmt,
      LINE_TOT: brokerage + dane + pAmt,
      ITEM_CAT: a.ITEM_CAT,
    };
  }

  function compareBrokerItemRows(a, b) {
    const byBroker = String(a.BK_CODE ?? '').localeCompare(String(b.BK_CODE ?? ''));
    if (byBroker !== 0) return byBroker;
    const byItem = String(a.ITEM_CODE ?? '').localeCompare(String(b.ITEM_CODE ?? ''));
    if (byItem !== 0) return byItem;
    const byItemName = String(a.ITEM_NAME ?? '').localeCompare(String(b.ITEM_NAME ?? ''));
    if (byItemName !== 0) return byItemName;
    const dateCmp = compareVrDate(a.BILL_DATE, b.BILL_DATE);
    if (dateCmp !== 0) return dateCmp;
    return String(a.BILL_NO ?? '').localeCompare(String(b.BILL_NO ?? ''));
  }

  async function runBrokerItemWiseBrokerItemDetail(comp_code, comp_uid, p) {
    const bkCode = String(p.detail_bk_code || '').trim().toUpperCase();
    const itemCode = String(p.detail_item_code ?? '').trim();
    const itemName = String(p.detail_item_name || '').trim().toUpperCase();
    if (!bkCode) {
      throw Object.assign(new Error('detail_bk_code is required'), { status: 400 });
    }
    if (!itemCode) {
      throw Object.assign(new Error('detail_item_code is required'), { status: 400 });
    }
    const raw = p.msp === 'P' ? await fetchPurchaseBrokerRaw(comp_code, comp_uid, p) : await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw
      .map((a) => mapBrokerItemWiseRow(a, p))
      .filter((r) => {
        if (String(r.BK_CODE ?? '').trim().toUpperCase() !== bkCode) return false;
        if (String(r.ITEM_CODE ?? '').trim() !== itemCode) return false;
        if (itemName && String(r.ITEM_NAME ?? '').trim().toUpperCase() !== itemName) return false;
        return true;
      })
      .sort(compareBrokerItemRows);
    return {
      rows: appendGrandTotal(rows, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runBrokerItemWise(comp_code, comp_uid, p) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'broker-item') {
      return runBrokerItemWiseBrokerItemDetail(comp_code, comp_uid, p);
    }
    const raw = p.msp === 'P' ? await fetchPurchaseBrokerRaw(comp_code, comp_uid, p) : await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw.map((a) => mapBrokerItemWiseRow(a, p)).sort(compareBrokerItemRows);
    if (p.mds === 'S') {
      const map = new Map();
      for (const r of rows) {
        const k = `${r.BK_CODE}|${r.BNAME}|${r.ITEM_CODE}|${r.ITEM_NAME}`;
        if (!map.has(k)) {
          map.set(k, {
            BK_CODE: r.BK_CODE,
            BNAME: r.BNAME,
            ITEM_CODE: r.ITEM_CODE,
            ITEM_NAME: r.ITEM_NAME,
            BAGS: 0,
            KATTA: 0,
            HKATTA: 0,
            WEIGHT: 0,
            AMOUNT: 0,
            FREIGHT: 0,
            BROKERAGE: 0,
            DANE_AMT: 0,
            P_AMT: 0,
            LINE_TOT: 0,
          });
        }
        const t = map.get(k);
        t.BAGS += num(r.BAGS); t.KATTA += num(r.KATTA); t.HKATTA += num(r.HKATTA);
        t.WEIGHT += num(r.WEIGHT); t.AMOUNT += num(r.AMOUNT); t.FREIGHT += num(r.FREIGHT);
        t.BROKERAGE += num(r.BROKERAGE); t.DANE_AMT += num(r.DANE_AMT); t.P_AMT += num(r.P_AMT);
        t.LINE_TOT += num(r.LINE_TOT);
      }
      const summed = [...map.values()].sort(compareBrokerItemRows);
      return {
        rows: appendGrandTotal(summed, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
        columns: inferColumnsFromRows(summed),
      };
    }
    return {
      rows: appendGrandTotal(rows, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runBrokerItemCatBrokerCatDetail(comp_code, comp_uid, p) {
    const bkCode = String(p.detail_bk_code || '').trim().toUpperCase();
    const itemCat = String(p.detail_item_cat ?? '').trim();
    if (!bkCode) {
      throw Object.assign(new Error('detail_bk_code is required'), { status: 400 });
    }
    const raw = await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw
      .map((a) => mapBrokerItemWiseRow(a, { ...p, msp: 'S' }))
      .filter((r) => {
        if (String(r.BK_CODE ?? '').trim().toUpperCase() !== bkCode) return false;
        if (itemCat && String(r.ITEM_CAT ?? '').trim() !== itemCat) return false;
        return true;
      })
      .sort(compareBrokerItemRows);
    return {
      rows: appendGrandTotal(rows, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runBrokerItemCat(comp_code, comp_uid, p) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'broker-item-cat') {
      return runBrokerItemCatBrokerCatDetail(comp_code, comp_uid, p);
    }
    const raw = await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw
      .map((a) => mapBrokerItemWiseRow(a, { ...p, msp: 'S' }))
      .sort(compareBrokerItemCatRows);
    if (p.mds === 'S') {
      const map = new Map();
      for (const r of rows) {
        const k = `${r.BK_CODE}|${r.BNAME}|${r.ITEM_CAT}`;
        if (!map.has(k)) {
          map.set(k, {
            BK_CODE: r.BK_CODE,
            BNAME: r.BNAME,
            ITEM_CAT: r.ITEM_CAT,
            BAGS: 0,
            KATTA: 0,
            HKATTA: 0,
            WEIGHT: 0,
            AMOUNT: 0,
            FREIGHT: 0,
            BROKERAGE: 0,
            DANE_AMT: 0,
            P_AMT: 0,
            LINE_TOT: 0,
          });
        }
        const t = map.get(k);
        t.BAGS += num(r.BAGS);
        t.KATTA += num(r.KATTA);
        t.HKATTA += num(r.HKATTA);
        t.WEIGHT += num(r.WEIGHT);
        t.AMOUNT += num(r.AMOUNT);
        t.FREIGHT += num(r.FREIGHT);
        t.BROKERAGE += num(r.BROKERAGE);
        t.DANE_AMT += num(r.DANE_AMT);
        t.P_AMT += num(r.P_AMT);
        t.LINE_TOT += num(r.LINE_TOT);
      }
      const summed = [...map.values()].sort(compareBrokerItemCatRows);
      return {
        rows: appendGrandTotal(summed, BROKER_DATE_SUM_KEYS, 'ITEM_CAT', 'GRAND TOTAL'),
        columns: inferColumnsFromRows(summed),
      };
    }
    return {
      rows: appendGrandTotal(rows, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  function compareBrokerItemCatRows(a, b) {
    const byBroker = String(a.BK_CODE ?? '').localeCompare(String(b.BK_CODE ?? ''));
    if (byBroker !== 0) return byBroker;
    const byName = String(a.BNAME ?? '').localeCompare(String(b.BNAME ?? ''));
    if (byName !== 0) return byName;
    const byCat = String(a.ITEM_CAT ?? '').localeCompare(String(b.ITEM_CAT ?? ''));
    if (byCat !== 0) return byCat;
    return compareBrokerItemRows(a, b);
  }

  async function runBrokerSummary(comp_code, comp_uid, p) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'broker') {
      return runBrokerDateWiseBrokerDetail(comp_code, comp_uid, { ...p, msp: 'S' });
    }
    const raw = await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw.map((a) => mapBrokerDateWiseRow(a, { ...p, msp: 'S' })).sort(compareBrokerReportRows);
    const map = new Map();
    for (const r of rows) {
      const k = `${r.BK_CODE}|${r.BNAME}`;
      if (!map.has(k)) {
        map.set(k, {
          BK_CODE: r.BK_CODE,
          BNAME: r.BNAME,
          BAGS: 0,
          KATTA: 0,
          HKATTA: 0,
          WEIGHT: 0,
          AMOUNT: 0,
          FREIGHT: 0,
          BROKERAGE: 0,
          DANE_AMT: 0,
          P_AMT: 0,
          LINE_TOT: 0,
        });
      }
      const t = map.get(k);
      t.BAGS += num(r.BAGS);
      t.KATTA += num(r.KATTA);
      t.HKATTA += num(r.HKATTA);
      t.WEIGHT += num(r.WEIGHT);
      t.AMOUNT += num(r.AMOUNT);
      t.FREIGHT += num(r.FREIGHT);
      t.BROKERAGE += num(r.BROKERAGE);
      t.DANE_AMT += num(r.DANE_AMT);
      t.P_AMT += num(r.P_AMT);
      t.LINE_TOT += num(r.LINE_TOT);
    }
    const summed = [...map.values()].sort((a, b) => {
      const byBroker = String(a.BK_CODE ?? '').localeCompare(String(b.BK_CODE ?? ''));
      if (byBroker !== 0) return byBroker;
      return String(a.BNAME ?? '').localeCompare(String(b.BNAME ?? ''));
    });
    return {
      rows: appendGrandTotal(summed, BROKER_DATE_SUM_KEYS, 'BNAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(summed),
    };
  }

  function compareBrokerReportRows(a, b) {
    const byBroker = String(a.BK_CODE ?? '').localeCompare(String(b.BK_CODE ?? ''));
    if (byBroker !== 0) return byBroker;
    const byName = String(a.BNAME ?? '').localeCompare(String(b.BNAME ?? ''));
    if (byName !== 0) return byName;
    const dateCmp = compareVrDate(a.BILL_DATE, b.BILL_DATE);
    if (dateCmp !== 0) return dateCmp;
    return String(a.BILL_NO ?? '').localeCompare(String(b.BILL_NO ?? ''));
  }

  function mapBrokerDateWiseRow(a, p) {
    const amount = p.rptype === 4
      ? num(a.AMOUNT)
      : num(a.AMOUNT) + (p.msp === 'P' ? 0 : num(a.FREIGHT));
    const qnty = num(a.QNTY);
    const brokerage = num(p.msp === 'P' ? a.BROK_AMT : a.BROKERAGE);
    const dane = num(a.DANE_AMT);
    const pAmt = p.msp === 'P' ? 0 : num(a.P_AMT1) + num(a.P_AMT2) + num(a.P_AMT3) + num(a.P_AMT5);
    return {
      BK_CODE: p.msp === 'P' ? a.B_CODE : a.BK_CODE,
      BNAME: a.BNAME,
      BILL_DATE: p.msp === 'P' ? a.R_DATE : a.BILL_DATE,
      BILL_NO: p.msp === 'P' ? a.R_NO : a.BILL_NO,
      TYPE: a.TYPE,
    B_TYPE: a.B_TYPE,
    CODE: a.CODE,
    NAME: a.NAME,
    ITEM_CODE: a.ITEM_CODE,
    ITEM_NAME: a.ITEM_NAME,
    BAGS: String(a.STATUS) === 'B' ? qnty : 0,
      KATTA: String(a.STATUS) === 'K' ? qnty : 0,
      HKATTA: String(a.STATUS) === 'H' ? qnty : 0,
      RATE: num(a.RATE),
      WEIGHT: num(a.WEIGHT),
      AMOUNT: amount,
      BROK_PER: num(p.msp === 'P' ? a.BROK_RATE : a.BROK_PER),
      FREIGHT: num(a.FREIGHT),
      BROKERAGE: brokerage,
      DANE_AMT: dane,
      P_AMT: pAmt,
      LINE_TOT: brokerage + dane + pAmt,
    };
  }

  const BROKER_DATE_SUM_KEYS = ['BAGS', 'KATTA', 'HKATTA', 'WEIGHT', 'AMOUNT', 'BROKERAGE', 'DANE_AMT', 'P_AMT', 'LINE_TOT', 'FREIGHT'];

  async function runBrokerDateWiseBrokerDetail(comp_code, comp_uid, p) {
    const bkCode = String(p.detail_bk_code || '').trim().toUpperCase();
    if (!bkCode) {
      throw Object.assign(new Error('detail_bk_code is required'), { status: 400 });
    }
    const raw = p.msp === 'P' ? await fetchPurchaseBrokerRaw(comp_code, comp_uid, p) : await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw
      .map((a) => mapBrokerDateWiseRow(a, p))
      .filter((r) => String(r.BK_CODE ?? '').trim().toUpperCase() === bkCode)
      .sort(compareBrokerReportRows);
    return {
      rows: appendGrandTotal(rows, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runBrokerDateWise(comp_code, comp_uid, p) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'broker') {
      return runBrokerDateWiseBrokerDetail(comp_code, comp_uid, p);
    }
    const raw = p.msp === 'P' ? await fetchPurchaseBrokerRaw(comp_code, comp_uid, p) : await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw.map((a) => mapBrokerDateWiseRow(a, p)).sort(compareBrokerReportRows);
    if (p.mds === 'S') {
      const map = new Map();
      for (const r of rows) {
        const k = `${r.BK_CODE}|${r.BNAME}`;
        if (!map.has(k)) {
          map.set(k, {
            BK_CODE: r.BK_CODE,
            BNAME: r.BNAME,
            BAGS: 0,
            KATTA: 0,
            HKATTA: 0,
            WEIGHT: 0,
            AMOUNT: 0,
            FREIGHT: 0,
            BROKERAGE: 0,
            DANE_AMT: 0,
            P_AMT: 0,
            LINE_TOT: 0,
          });
        }
        const t = map.get(k);
        t.BAGS += num(r.BAGS); t.KATTA += num(r.KATTA); t.HKATTA += num(r.HKATTA);
        t.WEIGHT += num(r.WEIGHT); t.AMOUNT += num(r.AMOUNT); t.FREIGHT += num(r.FREIGHT);
        t.BROKERAGE += num(r.BROKERAGE); t.DANE_AMT += num(r.DANE_AMT); t.P_AMT += num(r.P_AMT);
        t.LINE_TOT += num(r.LINE_TOT);
      }
      const summed = [...map.values()].sort((a, b) => {
        const byBroker = String(a.BK_CODE ?? '').localeCompare(String(b.BK_CODE ?? ''));
        if (byBroker !== 0) return byBroker;
        return String(a.BNAME ?? '').localeCompare(String(b.BNAME ?? ''));
      });
      return {
        rows: appendGrandTotal(summed, BROKER_DATE_SUM_KEYS, 'BNAME', 'GRAND TOTAL'),
        columns: inferColumnsFromRows(summed),
      };
    }
    return {
      rows: appendGrandTotal(rows, BROKER_DATE_SUM_KEYS, 'NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runBrokerPurchase(comp_code, comp_uid, p) {
    const raw = await fetchPurchaseBrokerRaw(comp_code, comp_uid, { ...p, msp: 'P' });
    const rows = mapBrokerItemWise(raw, true).filter((r) => num(r.BROKERAGE) !== 0 || num(r.DANE_AMT) !== 0);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runBrokerScheme(comp_code, comp_uid, p) {
    const raw = await fetchSaleBrokerRaw(comp_code, comp_uid, p);
    const rows = raw.map((a) => ({
      BK_CODE: a.BK_CODE, BNAME: a.BNAME, ITEM_CODE: a.ITEM_CODE, ITEM_NAME: a.ITEM_NAME,
      BAGS: String(a.STATUS) === 'B' ? num(a.QNTY) : 0,
      KATTA: String(a.STATUS) === 'K' ? num(a.QNTY) : 0,
      HKATTA: String(a.STATUS) === 'H' ? num(a.QNTY) : 0,
      WEIGHT: num(a.WEIGHT), AMOUNT: num(a.AMOUNT), BROKERAGE: num(a.BROKERAGE), DANE_AMT: num(a.DANE_AMT),
      P_AMT: num(a.P_AMT1) + num(a.P_AMT2) + num(a.P_AMT3) + num(a.P_AMT5), SUP_CODE: a.SUP_CODE,
    }));
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runBrokerDalaliFreight(comp_code, comp_uid, p) {
    return runBrokerDateWise(comp_code, comp_uid, { ...p, rptype: 4, msp: p.msp || 'S' });
  }

  async function runDalaliExcel(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE, D.NAME AS CUSTOMER, D.CITY, D.L_C,
        A.SUP_CODE, C.NAME AS SUP_NAME, C.SCHEDULE, A.ITEM_CODE, E.ITEM_NAME,
        CASE WHEN C.SCHEDULE = 12.10 THEN NVL(A.BROKERAGE,0) ELSE 0 END AS TDG_BROK,
        CASE WHEN C.SCHEDULE <> 12.10 THEN NVL(A.BROKERAGE,0) ELSE 0 END AS CONSG_BROK,
        CASE WHEN C.SCHEDULE = 12.10 THEN NVL(A.DANE_AMT,0) ELSE 0 END AS TDG_DANE,
        CASE WHEN C.SCHEDULE <> 12.10 THEN NVL(A.DANE_AMT,0) ELSE 0 END AS CONSG_DANE,
        A.BK_CODE, B.NAME AS BROKER_NAME
      FROM SALE A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.BK_CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.SUP_CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.CODE = D.CODE
      LEFT JOIN ITEMMAST E ON A.COMP_CODE = E.COMP_CODE AND A.ITEM_CODE = E.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${billBetweenSql('A.BILL_DATE')}
        AND NVL(A.BROKERAGE,0) + NVL(A.DANE_AMT,0) <> 0
      ORDER BY A.BILL_DATE, A.BILL_NO`;
    let rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (p.scode) rows = rows.filter((r) => String(r.SUP_CODE).trim() === p.scode);
    if (p.icode) rows = rows.filter((r) => num(r.ITEM_CODE) === p.icode);
    if (p.mcode) rows = rows.filter((r) => String(r.CODE).trim() === p.mcode);
    if (p.sb_code && p.eb_code) rows = rows.filter((r) => String(r.BK_CODE) >= p.sb_code && String(r.BK_CODE) <= p.eb_code);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

function insuranceCompCity(compAdd2) {
  const s = String(compAdd2 || '').trim().toUpperCase();
  if (!s) return '';
  const part = s.split('-')[0].trim();
  return part || s;
}

function insuranceFromTo(compCity, partyCity) {
  const from = String(compCity || '').trim().toUpperCase();
  const to = String(partyCity || '').trim().toUpperCase();
  if (from && to) return `${from} TO ${to}`;
  return from || to || '';
}

function mapInsuranceDetailRow(r, idx, compCity) {
  const invValue = num(r.INV_VALUE);
  const billAmt = num(r.AMOUNT);
  return {
    BILL_DATE: r.BILL_DATE,
    BILL_NO: r.BILL_NO,
    SR_NO: idx + 1,
    BAGS: num(r.BAGS),
    WEIGHT: num(r.WEIGHT),
    INV_VALUE: invValue,
    AMOUNT: billAmt,
    INV_PLUS_10: Math.round(billAmt * 1.1 * 100) / 100,
    TRUCK_NO: String(r.TRUCK_NO ?? '').trim(),
    BILTY_NO: String(r.BILTY_NO ?? '').trim(),
    FROM_TO: insuranceFromTo(compCity, r.CITY),
  };
}

  async function runInsurance(comp_code, comp_uid, p) {
    let compCity = '';
    try {
      const compRows = await q(
        `SELECT COMP_ADD2 FROM COMPANY WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code },
        comp_uid
      );
      compCity = insuranceCompCity(compRows[0]?.COMP_ADD2 ?? compRows[0]?.comp_add2);
    } catch {
      compCity = '';
    }

    const sql = `
      SELECT A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE, B.NAME, B.CITY, B.L_C,
        SUM(CASE WHEN A.TYPE = 'SL' THEN NVL(A.QNTY,0) ELSE NVL(A.QNTY,0) * -1 END) BAGS,
        SUM(CASE WHEN A.TYPE = 'SL' THEN NVL(A.WEIGHT,0) ELSE NVL(A.WEIGHT,0) * -1 END) WEIGHT,
        SUM(CASE WHEN A.TYPE = 'SL' THEN NVL(A.AMOUNT,0) ELSE NVL(A.AMOUNT,0) * -1 END) INV_VALUE,
        SUM(CASE WHEN A.TYPE = 'SL' THEN NVL(A.BILL_AMT,0) ELSE NVL(A.BILL_AMT,0) * -1 END) AMOUNT,
        MAX(A.TRUCK_NO) TRUCK_NO, MAX(A.GR_NO) BILTY_NO, MAX(A.TPT) TPT
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND A.TYPE IN ('SL','CN')
        AND ${billBetweenSql('A.BILL_DATE')}
      GROUP BY A.TYPE, A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.CODE, B.NAME, B.CITY, B.L_C
      ORDER BY A.BILL_DATE, A.BILL_NO`;
    let rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (p.mlc === 'L') rows = rows.filter((r) => String(r.L_C) === 'L');
    else if (p.mlc === 'C') rows = rows.filter((r) => String(r.B_TYPE) === 'C' || String(r.L_C) === 'C');
    if (p.rpttype === 'S') rows = rows.filter((r) => String(r.TYPE) === 'SL');
    else if (p.rpttype === 'C') rows = rows.filter((r) => String(r.TYPE) === 'CN');

    const sumKeys = ['BAGS', 'WEIGHT', 'INV_VALUE', 'AMOUNT', 'INV_PLUS_10'];

    if (p.mcn === 'S') {
      const map = new Map();
      for (const r of rows) {
        const k = dateMapKey(r.BILL_DATE);
        if (!map.has(k)) {
          map.set(k, { BILL_DATE: r.BILL_DATE, BAGS: 0, WEIGHT: 0, INV_VALUE: 0, AMOUNT: 0 });
        }
        const t = map.get(k);
        t.BAGS += num(r.BAGS);
        t.WEIGHT += num(r.WEIGHT);
        t.INV_VALUE += num(r.INV_VALUE);
        t.AMOUNT += num(r.AMOUNT);
      }
      const summed = [...map.values()]
        .sort((a, b) => compareVrDate(a.BILL_DATE, b.BILL_DATE))
        .map((t) => ({
          BILL_DATE: t.BILL_DATE,
          BAGS: t.BAGS,
          WEIGHT: t.WEIGHT,
          INV_VALUE: t.INV_VALUE,
          AMOUNT: t.AMOUNT,
          INV_PLUS_10: Math.round(t.AMOUNT * 1.1 * 100) / 100,
        }));
      return {
        rows: appendGrandTotal(summed, sumKeys, 'BILL_DATE', 'GRAND TOTAL'),
        columns: inferColumnsFromRows(summed),
      };
    }

    const detail = rows.map((r, idx) => mapInsuranceDetailRow(r, idx, compCity));
    return {
      rows: appendGrandTotal(detail, sumKeys, 'FROM_TO', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(detail),
    };
  }

  async function runTradingExp(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.CODE, B.NAME, A.VR_TYPE, A.VR_DATE, A.VR_NO, A.TYPE, A.DETAIL, A.DR_AMT, A.CR_AMT
      FROM LEDGER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND A.VR_TYPE IN ('CV','BV','JV')
        AND B.SCHEDULE IN (12.10, 14.10)
      ORDER BY A.CODE, A.VR_DATE, A.VR_NO`;
    let rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (p.mcode) rows = rows.filter((r) => String(r.CODE).trim() === p.mcode);
    return {
      rows: appendGrandTotal(rows, ['DR_AMT', 'CR_AMT'], 'DETAIL', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runBrokerLedger(comp_code, comp_uid, p) {
    if (!p.mcode) throw Object.assign(new Error('Broker / party code (mcode) is required'), { status: 400 });
    const sql = `
      SELECT A.CODE, A.VR_DATE, A.VR_NO, A.DR_AMT, A.CR_AMT, A.DETAIL, A.CHQ_NO, A.VR_TYPE, B.NAME, B.ADD1, B.ADD2, B.ADD3, B.CITY, B.PAN
      FROM (
        SELECT CODE, VR_DATE, VR_NO, DR_AMT, CR_AMT, DETAIL, CHQ_NO, VR_TYPE FROM LEDGER
        WHERE COMP_CODE = :comp_code AND CODE = :mcode AND VR_DATE <= TO_DATE(:e_date,'DD-MM-YYYY') AND NVL(BIKRI,'X') <> 'Y'
        UNION ALL
        SELECT CODE, VR_DATE, VR_NO, DR_AMT, CR_AMT, DETAIL, CHQ_NO, VR_TYPE FROM BROKLEG
        WHERE COMP_CODE = :comp_code AND CODE = :mcode AND VR_DATE <= TO_DATE(:e_date,'DD-MM-YYYY') AND NVL(BIKRI,'X') <> 'Y'
      ) A
      INNER JOIN MASTER B ON B.COMP_CODE = :comp_code AND A.CODE = B.CODE
      WHERE A.VR_DATE >= TO_DATE(:s_date,'DD-MM-YYYY')
      ORDER BY A.VR_DATE, A.VR_NO`;
    const rows = await q(sql, { comp_code, mcode: p.mcode, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    return { rows: appendGrandTotal(rows, ['DR_AMT', 'CR_AMT'], 'DETAIL', 'GRAND TOTAL'), columns: inferColumnsFromRows(rows) };
  }

  async function runBrokerTrial(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.CODE, A.NAME, A.CITY, A.SCHEDULE AS SCH_NO,
        SUM(CASE WHEN A.VR_DATE < TO_DATE(:s_date,'DD-MM-YYYY') THEN NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0) ELSE 0 END) OPBAL,
        SUM(CASE WHEN A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY') THEN NVL(A.DR_AMT,0) ELSE 0 END) DR_AMT,
        SUM(CASE WHEN A.VR_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY') THEN NVL(A.CR_AMT,0) ELSE 0 END) CR_AMT,
        SUM(NVL(A.DR_AMT,0) - NVL(A.CR_AMT,0)) CLBAL
      FROM (
        SELECT L.CODE, M.NAME, M.CITY, M.SCHEDULE, L.VR_DATE, L.DR_AMT, L.CR_AMT
        FROM LEDGER L INNER JOIN MASTER M ON L.COMP_CODE = M.COMP_CODE AND L.CODE = M.CODE
        WHERE L.COMP_CODE = :comp_code AND SUBSTR(L.CODE,1,1) = 'B' AND L.VR_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
        UNION ALL
        SELECT L.CODE, M.NAME, M.CITY, M.SCHEDULE, L.VR_DATE, L.DR_AMT, L.CR_AMT
        FROM BROKLEG L INNER JOIN MASTER M ON L.COMP_CODE = M.COMP_CODE AND L.CODE = M.CODE
        WHERE L.COMP_CODE = :comp_code AND SUBSTR(L.CODE,1,1) = 'B' AND L.VR_DATE <= TO_DATE(:e_date,'DD-MM-YYYY')
      ) A
      GROUP BY A.CODE, A.NAME, A.CITY, A.SCHEDULE
      ORDER BY A.NAME`;
    const rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    return { rows: appendGrandTotal(rows, ['OPBAL','DR_AMT','CR_AMT','CLBAL']), columns: inferColumnsFromRows(rows) };
  }

  async function runPaploo(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.P_CODE1, A.P_CODE2, A.P_CODE3, A.P_CODE5,
        A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT,
        NVL(A.PAPLOO1,0) PAPLOO1, NVL(A.PAPLOO2,0) PAPLOO2, NVL(A.PAPLOO3,0) PAPLOO3, NVL(A.PAPLOO5,0) PAPLOO5,
        NVL(A.P_AMT1,0) P_AMT1, NVL(A.P_AMT2,0) P_AMT2, NVL(A.P_AMT3,0) P_AMT3, NVL(A.P_AMT5,0) P_AMT5,
        B.NAME P_NAME1, C.NAME P_NAME2, D.NAME P_NAME3, E.NAME P_NAME5
      FROM SALE A
      LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.P_CODE1 = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.P_CODE2 = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.P_CODE3 = D.CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.P_CODE5 = E.CODE
      WHERE A.COMP_CODE = :comp_code AND A.TYPE = 'SL'
        AND ${billBetweenSql('A.BILL_DATE')}
        AND (NVL(A.P_AMT1,0) <> 0 OR NVL(A.P_AMT2,0) <> 0 OR NVL(A.P_AMT3,0) <> 0 OR NVL(A.P_AMT5,0) <> 0)
      ORDER BY A.BILL_DATE, A.BILL_NO`;
    let rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (p.mcode) {
      rows = rows.filter((r) => [r.P_CODE1, r.P_CODE2, r.P_CODE3, r.P_CODE5].map((x) => String(x || '').trim()).includes(p.mcode));
    }
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runAdvPayment(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.VR_DATE, A.VR_NO, A.VR_TYPE, A.CODE, B.NAME, A.DETAIL, A.DR_AMT, A.CR_AMT, A.BILL_DATE
      FROM VOUCHER A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND ${betweenDatesSql('A.VR_DATE')}
        AND A.BILL_DATE IS NOT NULL AND NVL(A.BILL_NO,0) = 0
      ORDER BY A.VR_DATE, A.VR_NO`;
    const rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function fetchChantSale(comp_code, comp_uid, p) {
    const sql = `
      SELECT A.BILL_DATE, A.BILL_NO, A.SUP_CODE, B.NAME, B.CITY, A.ITEM_CODE, C.ITEM_NAME, A.LOT, A.STATUS,
        A.QNTY, A.WEIGHT, A.RATE, A.AMOUNT, A.COMM_PER, A.BROK_PER, A.REMARKS, A.GOD_CODE, A.B_TYPE, A.MSUP_CODE
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.SUP_CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenSql('A.BILL_DATE')}
      ORDER BY A.BILL_DATE, B.NAME, A.SUP_CODE, A.ITEM_CODE, A.LOT, A.RATE`;
    let rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (p.scode) rows = rows.filter((r) => String(r.SUP_CODE).trim() === String(p.scode).trim());
    if (p.icode) rows = rows.filter((r) => String(r.ITEM_CODE).trim() === String(p.icode).trim());
    if (p.btype) rows = rows.filter((r) => String(r.B_TYPE).trim() === p.btype);
    if (p.god_code) rows = rows.filter((r) => String(r.GOD_CODE).trim() === p.god_code);
    if (p.m_sup_code) rows = rows.filter((r) => String(r.MSUP_CODE).trim() === p.m_sup_code);
    return rows;
  }

  async function runChantFormat1(comp_code, comp_uid, p) {
    const rows = await fetchChantSale(comp_code, comp_uid, p);
    return {
      rows: appendGrandTotal(rows, ['QNTY', 'WEIGHT', 'AMOUNT'], 'BILL_NO', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runChantFormat2(comp_code, comp_uid, p) {
    return runChantFormat1(comp_code, comp_uid, p);
  }

  async function runChantFormat3(comp_code, comp_uid, p) {
    return runChantFormat1(comp_code, comp_uid, p);
  }

  async function runChantDetail(comp_code, comp_uid, p) {
    const rows = await fetchChantSale(comp_code, comp_uid, p);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runChantSummary(comp_code, comp_uid, p) {
    const raw = await fetchChantSale(comp_code, comp_uid, p);
    const map = new Map();
    const dateKey = (d) => {
      if (d == null || d === '') return '';
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${d.getFullYear()}`;
      }
      return String(d).trim();
    };
    for (const r of raw) {
      const k = [
        dateKey(r.BILL_DATE),
        String(r.SUP_CODE ?? '').trim(),
        String(r.NAME ?? '').trim(),
        String(r.CITY ?? '').trim(),
        String(r.ITEM_CODE ?? '').trim(),
        String(r.ITEM_NAME ?? '').trim(),
        String(r.STATUS ?? '').trim(),
        String(r.RATE ?? '').trim(),
      ].join('|');
      if (!map.has(k)) {
        map.set(k, {
          BILL_DATE: r.BILL_DATE,
          BILL_NO: '',
          SUP_CODE: r.SUP_CODE,
          NAME: r.NAME,
          CITY: r.CITY,
          ITEM_CODE: r.ITEM_CODE,
          ITEM_NAME: r.ITEM_NAME,
          LOT: r.LOT,
          REMARKS: r.REMARKS,
          STATUS: r.STATUS,
          RATE: r.RATE,
          QNTY: 0,
          WEIGHT: 0,
          AMOUNT: 0,
        });
      }
      const t = map.get(k);
      t.QNTY += num(r.QNTY);
      t.WEIGHT += num(r.WEIGHT);
      t.AMOUNT += num(r.AMOUNT);
      const lot = String(r.LOT ?? '').trim();
      if (lot && (!t.LOT || lot.localeCompare(String(t.LOT)) > 0)) t.LOT = r.LOT;
      if (!t.REMARKS && r.REMARKS) t.REMARKS = r.REMARKS;
    }
    const rows = [...map.values()].sort((a, b) => {
      const ad = dateKey(a.BILL_DATE);
      const bd = dateKey(b.BILL_DATE);
      if (ad !== bd) return ad.localeCompare(bd);
      const an = String(a.NAME ?? '');
      const bn = String(b.NAME ?? '');
      if (an !== bn) return an.localeCompare(bn);
      const asc = String(a.SUP_CODE ?? '');
      const bsc = String(b.SUP_CODE ?? '');
      if (asc !== bsc) return asc.localeCompare(bsc);
      const aic = String(a.ITEM_CODE ?? '');
      const bic = String(b.ITEM_CODE ?? '');
      if (aic !== bic) return aic.localeCompare(bic, undefined, { numeric: true });
      return Number(a.RATE) - Number(b.RATE);
    });
    return {
      rows: appendGrandTotal(rows, ['QNTY', 'WEIGHT', 'AMOUNT'], 'ITEM_NAME', 'GRAND TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runPartyBills(comp_code, comp_uid, p, { prefix, balanceMode }) {
    if (!p.mcode) throw Object.assign(new Error('Party code (mcode) is required'), { status: 400 });
    const sql = `
      SELECT A.CODE, B.NAME, B.CITY, A.VR_TYPE, A.VR_DATE, A.VR_NO, A.BILL_DATE, A.BILL_NO, A.B_TYPE,
        A.V_DATE, A.DR_AMT, A.CR_AMT, A.DAYS, A.DAMI, A.BK_CODE, A.ITEM_CODE, A.DETAIL
      FROM BILLS A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code AND A.CODE = :mcode
        AND A.BILL_DATE BETWEEN TO_DATE(:s_date,'DD-MM-YYYY') AND TO_DATE(:e_date,'DD-MM-YYYY')
      ORDER BY A.BILL_DATE, A.BILL_NO, A.VR_DATE`;
    let rows = await q(sql, { comp_code, mcode: p.mcode, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    if (prefix) rows = rows.filter((r) => String(r.CODE).startsWith(prefix));
    if (balanceMode === 'freight') {
      rows = rows.map((r) => ({ ...r, BAL: num(r.CR_AMT) - num(r.DR_AMT) }));
    } else {
      rows = rows.map((r) => ({ ...r, BAL: num(r.DR_AMT) - num(r.CR_AMT) }));
    }
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  async function runMonthOutstandingDetail(comp_code, comp_uid, p, { prefix }) {
    const detailMonth = String(p.detail_month || '').trim();
    if (!detailMonth) {
      throw Object.assign(new Error('detail_month is required (DD-MM-YYYY, first day of month)'), { status: 400 });
    }
    if (!p.e_date) {
      throw Object.assign(new Error('As on date (edt) is required'), { status: 400 });
    }
    const sql = `
      SELECT A.BILL_DATE, A.BILL_NO, A.CODE, B.NAME, A.VR_DATE, A.VR_NO, A.VR_TYPE,
        A.DR_AMT, A.CR_AMT, A.DETAIL, A.B_TYPE
      FROM BILLS A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.BILL_DATE, 'MM') = TRUNC(TO_DATE(:detail_month, 'DD-MM-YYYY'), 'MM')
        AND A.BILL_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND SUBSTR(A.CODE, 1, 1) = :prefix
      ORDER BY A.BILL_DATE, B.NAME, A.BILL_NO, A.VR_DATE, A.VR_NO`;
    const rows = await q(sql, {
      comp_code,
      detail_month: detailMonth,
      e_date: p.e_date,
      prefix,
    }, comp_uid);
    return {
      rows: appendGrandTotal(rows, ['DR_AMT', 'CR_AMT'], 'NAME', 'TOTAL'),
      columns: inferColumnsFromRows(rows),
    };
  }

  async function runMonthOutstanding(comp_code, comp_uid, p, { prefix, mode = 'purchase' }) {
    if (String(p.detail_mode || '').trim().toLowerCase() === 'month') {
      return runMonthOutstandingDetail(comp_code, comp_uid, p, { prefix });
    }
    if (!p.e_date) {
      throw Object.assign(new Error('As on date (edt) is required'), { status: 400 });
    }
    const monthlySql = `
      SELECT TRUNC(A.BILL_DATE, 'MM') AS MTH_SORT,
        TO_CHAR(A.BILL_DATE, 'MON-YYYY') AS CMTH,
        SUM(NVL(A.DR_AMT, 0)) DR_AMT,
        SUM(NVL(A.CR_AMT, 0)) CR_AMT
      FROM BILLS A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND A.BILL_DATE <= TO_DATE(:e_date, 'DD-MM-YYYY')
        AND SUBSTR(A.CODE, 1, 1) = :prefix
      GROUP BY TRUNC(A.BILL_DATE, 'MM'), TO_CHAR(A.BILL_DATE, 'MON-YYYY')
      ORDER BY TRUNC(A.BILL_DATE, 'MM')`;
    const monthlyRows = await q(monthlySql, { comp_code, e_date: p.e_date, prefix }, comp_uid);

    const periodStart = p.s_date ? monthStartOf(p.s_date) : null;
    const periodEnd = monthStartOf(p.e_date);
    const isPurchase = mode !== 'sale';
    const netMovement = (dr, cr) => (isPurchase ? num(cr) - num(dr) : num(dr) - num(cr));

    const monthTotals = new Map();
    for (const r of monthlyRows) {
      const mk = monthKeyFromValue(r.MTH_SORT ?? r.CMTH);
      if (!mk) continue;
      if (!monthTotals.has(mk)) {
        monthTotals.set(mk, {
          cmth: String(r.CMTH ?? '').trim() || formatCmthLabel(r.MTH_SORT),
          dr: 0,
          cr: 0,
        });
      }
      const bucket = monthTotals.get(mk);
      bucket.dr += num(r.DR_AMT);
      bucket.cr += num(r.CR_AMT);
    }

    const allMonthKeys = [...monthTotals.keys()].sort();
    if (!allMonthKeys.length || !periodEnd) {
      return { rows: [], columns: inferColumnsFromRows([]) };
    }

    const startMk = periodStart ? monthKeyFromValue(periodStart) : allMonthKeys[0];
    const startDate = parseMonthKey(startMk) || parseMonthKey(allMonthKeys[0]);
    if (!startDate) {
      return { rows: [], columns: inferColumnsFromRows([]) };
    }

    let running = 0;
    for (const mk of allMonthKeys) {
      if (mk >= startMk) break;
      const bucket = monthTotals.get(mk);
      running += netMovement(bucket.dr, bucket.cr);
    }

    const out = [];
    for (const mDate of enumerateCalendarMonths(startDate, periodEnd)) {
      const mk = monthKeyFromValue(mDate);
      const bucket = monthTotals.get(mk) || {
        cmth: formatCmthLabel(mDate),
        dr: 0,
        cr: 0,
      };
      const opbal = running;
      const drAmt = bucket.dr;
      const crAmt = bucket.cr;
      const clbal = opbal + netMovement(drAmt, crAmt);
      running = clbal;

      if (opbal || drAmt || crAmt || clbal) {
        out.push({
          CMTH: bucket.cmth,
          MTH_KEY: mk,
          OPBAL: Math.round(opbal * 100) / 100,
          DR_AMT: drAmt,
          CR_AMT: crAmt,
          CLBAL: Math.round(clbal * 100) / 100,
        });
      }
    }

    return {
      rows: appendGrandTotal(out, ['DR_AMT', 'CR_AMT'], 'CMTH', 'TOTAL'),
      columns: inferColumnsFromRows(out),
    };
  }

  async function runCombined(comp_code, comp_uid, p) {
    const sql = `
      SELECT 'SALE' AS SRC, A.BILL_DATE AS TRN_DATE, A.BILL_NO AS TRN_NO, A.CODE, B.NAME, A.ITEM_CODE, C.ITEM_NAME,
        A.QNTY, A.WEIGHT, A.AMOUNT, A.BK_CODE
      FROM SALE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND A.TYPE = 'SL' AND ${billBetweenSql('A.BILL_DATE')}
      UNION ALL
      SELECT 'PUR' AS SRC, A.R_DATE AS TRN_DATE, A.R_NO AS TRN_NO, A.CODE, B.NAME, A.ITEM_CODE, C.ITEM_NAME,
        A.QNTY, A.WEIGHT, A.AMOUNT, A.B_CODE AS BK_CODE
      FROM PURCHASE A
      INNER JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      INNER JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      WHERE A.COMP_CODE = :comp_code AND ${billBetweenSql('A.R_DATE')}
      ORDER BY 2, 3`;
    const rows = await q(sql, { comp_code, s_date: p.s_date, e_date: p.e_date }, comp_uid);
    return { rows, columns: inferColumnsFromRows(rows) };
  }

  const HANDLERS = {
    'labour-report': runLabour,
    'brokerage-date-wise': runBrokerDateWise,
    'brokerage-item-wise': runBrokerItemWise,
    'insurance-report': runInsurance,
    'brokerage-item-cat-wise': runBrokerItemCat,
    'broker-summary': runBrokerSummary,
    'trading-exp': runTradingExp,
    'broker-ledger': runBrokerLedger,
    'broker-trial': runBrokerTrial,
    'paploo-report': runPaploo,
    'brokerage-purchase': runBrokerPurchase,
    'voucher-adv-payment-revd': runAdvPayment,
    'chant-format-1': runChantFormat1,
    'chant-format-2': runChantFormat2,
    'chant-format-3': runChantFormat3,
    'chant-summary': runChantSummary,
    'broker-wise-scheme': runBrokerScheme,
    'broker-dalali-less-freight': runBrokerDalaliFreight,
    'freight-party-ledger': (cc, cu, p) => runPartyBills(cc, cu, p, { prefix: 'F', balanceMode: 'freight' }),
    'indent-party-ledger': (cc, cu, p) => runPartyBills(cc, cu, p, { prefix: 'I', balanceMode: 'indent' }),
    'purchase-outstanding-month': (cc, cu, p) => runMonthOutstanding(cc, cu, p, { prefix: 'S', mode: 'purchase' }),
    'sale-outstanding-month': (cc, cu, p) => runMonthOutstanding(cc, cu, p, { prefix: 'C', mode: 'sale' }),
    'dalali-excel': runDalaliExcel,
    'combined-sale-purchase': runCombined,
  };

  async function buildOtherReport(reportId, comp_code, comp_uid, params = {}) {
    const id = String(reportId || '').trim().toLowerCase();
    const handler = HANDLERS[id];
    if (!handler) {
      throw Object.assign(new Error(`Unknown other report id: "${reportId}"`), { status: 400 });
    }
    const cc = String(comp_code ?? '').trim();
    if (!cc) throw Object.assign(new Error('comp_code is required'), { status: 400 });
    if (comp_uid == null) throw Object.assign(new Error('comp_uid is required'), { status: 400 });
    const p = normalizeParams(params);
    if (!p.s_date || !p.e_date) {
      throw Object.assign(new Error('s_date and e_date are required (DD-MM-YYYY)'), { status: 400 });
    }
    const result = await handler(cc, comp_uid, p);
    const rows = result.rows ?? [];
    const columns = result.columns ?? inferColumnsFromRows(rows);
    return { rows, columns };
  }

  return { buildOtherReport };
}

module.exports = {
  createOtherReports,
  REPORT_IDS,
  humanizeColumnKey,
};
