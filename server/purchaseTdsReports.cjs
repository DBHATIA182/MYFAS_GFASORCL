/**
 * GST module — Party Wise Purchase/Sale Detail/Summary (TDS)
 * VFP tcs_rpt:
 * 3 purchase detail -> tds_rpt2
 * 4 purchase summary -> tds_rpt1
 * 5 sale detail -> tds_rpt4
 * 6 sale summary -> tds_rpt3
 */

'use strict';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function txt(v) {
  return String(v ?? '').trim();
}

function ymdFromDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return txt(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeBillRow(row, creditType = 'DN', dateKey = 'R_DATE', noKey = 'R_NO', extraKeys = []) {
  const type = txt(row.TYPE).toUpperCase();
  const amount = num(row.AMOUNT);
  const tdsOnAmt = num(row.TDS_ON_AMT);
  const tdsAmt = num(row.TDS_AMT);
  const signed =
    type === creditType
      ? { AMOUNT: -amount, TDS_ON_AMT: -tdsOnAmt, TDS_AMT: -tdsAmt }
      : { AMOUNT: amount, TDS_ON_AMT: tdsOnAmt, TDS_AMT: tdsAmt };
  const out = {
    CODE: txt(row.CODE),
    NAME: txt(row.NAME),
    ADD1: txt(row.ADD1),
    ADD2: txt(row.ADD2),
    CITY: txt(row.CITY),
    STATE: txt(row.STATE),
    STATE_CODE: txt(row.STATE_CODE),
    PAN: txt(row.PAN),
    GST_NO: txt(row.GST_NO),
    [dateKey]: ymdFromDate(row[dateKey]),
    [noKey]: txt(row[noKey]),
    TYPE: type,
    TDS_PER: num(row.TDS_PER),
    ...signed,
  };
  extraKeys.forEach((key) => {
    out[key] = txt(row[key]);
  });
  return out;
}

function purchaseTdsBaseSql(partyCode) {
  const partyFilter = partyCode ? "\n      AND TRIM(A.CODE) = TRIM(:party_code)" : '';
  return `
    SELECT
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.ADD1, '') AS ADD1,
      NVL(B.ADD2, '') AS ADD2,
      NVL(B.CITY, '') AS CITY,
      NVL(B.STATE, '') AS STATE,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.PAN, '') AS PAN,
      NVL(B.GST_NO, '') AS GST_NO,
      A.R_DATE,
      A.R_NO,
      NVL(A.TYPE, '') AS TYPE,
      SUM(NVL(A.AMOUNT, 0)) AS AMOUNT,
      MAX(NVL(A.NTDS_PER, 0)) AS TDS_PER,
      SUM(NVL(A.NTDS_ON_AMT, 0)) AS TDS_ON_AMT,
      SUM(NVL(A.NTDS_AMT, 0)) AS TDS_AMT
    FROM PURCHASE A
    JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1${partyFilter}
    GROUP BY
      A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.STATE, B.STATE_CODE, B.PAN, B.GST_NO,
      A.R_DATE, A.R_NO, A.TYPE
    ORDER BY B.NAME, A.CODE, A.R_DATE, A.R_NO`;
}

function purchaseTdsSummarySql(partyCode) {
  const partyFilter = partyCode ? "\n      AND TRIM(A.CODE) = TRIM(:party_code)" : '';
  return `
    SELECT
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.ADD1, '') AS ADD1,
      NVL(B.ADD2, '') AS ADD2,
      NVL(B.CITY, '') AS CITY,
      NVL(B.STATE, '') AS STATE,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.PAN, '') AS PAN,
      SUM(
        CASE WHEN UPPER(TRIM(A.TYPE)) = 'DN' THEN -NVL(A.AMOUNT, 0) ELSE NVL(A.AMOUNT, 0) END
      ) AS AMOUNT,
      MAX(NVL(A.NTDS_PER, 0)) AS TDS_PER,
      SUM(
        CASE WHEN UPPER(TRIM(A.TYPE)) = 'DN' THEN -NVL(A.NTDS_ON_AMT, 0) ELSE NVL(A.NTDS_ON_AMT, 0) END
      ) AS TDS_ON_AMT,
      SUM(
        CASE WHEN UPPER(TRIM(A.TYPE)) = 'DN' THEN -NVL(A.NTDS_AMT, 0) ELSE NVL(A.NTDS_AMT, 0) END
      ) AS TDS_AMT
    FROM PURCHASE A
    JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.R_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')
      AND A.R_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1${partyFilter}
    GROUP BY
      A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.STATE, B.STATE_CODE, B.PAN
    ORDER BY B.NAME, A.CODE`;
}

function saleTdsBaseSql(partyCode) {
  const partyFilter = partyCode ? "\n      AND TRIM(A.CODE) = TRIM(:party_code)" : '';
  return `
    SELECT
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.ADD1, '') AS ADD1,
      NVL(B.ADD2, '') AS ADD2,
      NVL(B.CITY, '') AS CITY,
      NVL(B.STATE, '') AS STATE,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.PAN, '') AS PAN,
      NVL(B.GST_NO, '') AS GST_NO,
      A.BILL_DATE,
      A.BILL_NO,
      NVL(A.TYPE, '') AS TYPE,
      NVL(A.B_TYPE, '') AS B_TYPE,
      SUM(NVL(A.AMOUNT, 0)) AS AMOUNT,
      MAX(NVL(A.TDS_PER, 0)) AS TDS_PER,
      SUM(NVL(A.TDS_ON_AMT, 0)) AS TDS_ON_AMT,
      SUM(NVL(A.TDS_AMT, 0)) AS TDS_AMT
    FROM SALE A
    JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.BILL_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1${partyFilter}
    GROUP BY
      A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.STATE, B.STATE_CODE, B.PAN, B.GST_NO,
      A.BILL_DATE, A.BILL_NO, A.TYPE, A.B_TYPE
    ORDER BY B.NAME, A.CODE, A.BILL_DATE, A.BILL_NO`;
}

function saleTdsSummarySql(partyCode) {
  const partyFilter = partyCode ? "\n      AND TRIM(A.CODE) = TRIM(:party_code)" : '';
  return `
    SELECT
      A.CODE,
      NVL(B.NAME, '') AS NAME,
      NVL(B.ADD1, '') AS ADD1,
      NVL(B.ADD2, '') AS ADD2,
      NVL(B.CITY, '') AS CITY,
      NVL(B.STATE, '') AS STATE,
      NVL(B.STATE_CODE, '') AS STATE_CODE,
      NVL(B.PAN, '') AS PAN,
      SUM(
        CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.AMOUNT, 0) ELSE NVL(A.AMOUNT, 0) END
      ) AS AMOUNT,
      MAX(NVL(A.TDS_PER, 0)) AS TDS_PER,
      SUM(
        CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.TDS_ON_AMT, 0) ELSE NVL(A.TDS_ON_AMT, 0) END
      ) AS TDS_ON_AMT,
      SUM(
        CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.TDS_AMT, 0) ELSE NVL(A.TDS_AMT, 0) END
      ) AS TDS_AMT
    FROM SALE A
    JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
    WHERE A.COMP_CODE = :comp_code
      AND A.BILL_DATE >= TO_DATE(:s_date, 'DD-MM-YYYY')
      AND A.BILL_DATE < TO_DATE(:e_date, 'DD-MM-YYYY') + 1${partyFilter}
    GROUP BY
      A.CODE, B.NAME, B.ADD1, B.ADD2, B.CITY, B.STATE, B.STATE_CODE, B.PAN
    ORDER BY B.NAME, A.CODE`;
}

function normalizeSummaryRow(row) {
  return {
    CODE: txt(row.CODE),
    NAME: txt(row.NAME),
    ADD1: txt(row.ADD1),
    ADD2: txt(row.ADD2),
    CITY: txt(row.CITY),
    STATE: txt(row.STATE),
    STATE_CODE: txt(row.STATE_CODE),
    PAN: txt(row.PAN),
    AMOUNT: num(row.AMOUNT),
    TDS_ON_AMT: num(row.TDS_ON_AMT),
    TDS_PER: num(row.TDS_PER),
    TDS_AMT: num(row.TDS_AMT),
  };
}

function createPurchaseTdsReports(runQuery) {
  async function buildPurchaseTdsDetailRows({ comp_code, comp_uid, s_date, e_date, party_code }) {
    const partyCode = txt(party_code);
    const binds = { comp_code, s_date, e_date };
    if (partyCode) binds.party_code = partyCode;
    const rows = await runQuery(purchaseTdsBaseSql(partyCode), binds, comp_uid);
    return (rows || []).map((row) => normalizeBillRow(row, 'DN', 'R_DATE', 'R_NO'));
  }

  async function buildPurchaseTdsSummaryRows({ comp_code, comp_uid, s_date, e_date, party_code }) {
    const partyCode = txt(party_code);
    const binds = { comp_code, s_date, e_date };
    if (partyCode) binds.party_code = partyCode;
    const rows = await runQuery(purchaseTdsSummarySql(partyCode), binds, comp_uid);
    return (rows || []).map(normalizeSummaryRow);
  }

  async function buildSaleTdsDetailRows({ comp_code, comp_uid, s_date, e_date, party_code }) {
    const partyCode = txt(party_code);
    const binds = { comp_code, s_date, e_date };
    if (partyCode) binds.party_code = partyCode;
    const rows = await runQuery(saleTdsBaseSql(partyCode), binds, comp_uid);
    return (rows || []).map((row) =>
      normalizeBillRow(row, 'CN', 'BILL_DATE', 'BILL_NO', ['B_TYPE'])
    );
  }

  async function buildSaleTdsSummaryRows({ comp_code, comp_uid, s_date, e_date, party_code }) {
    const partyCode = txt(party_code);
    const binds = { comp_code, s_date, e_date };
    if (partyCode) binds.party_code = partyCode;
    const rows = await runQuery(saleTdsSummarySql(partyCode), binds, comp_uid);
    return (rows || []).map(normalizeSummaryRow);
  }

  function registerRoutes(app) {
    app.get('/api/purchase-tds-detail', async (req, res) => {
      try {
        const { comp_code, comp_uid, s_date, e_date, party_code } = req.query;
        if (!comp_code || comp_uid == null || !s_date || !e_date) {
          return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date required' });
        }
        const rows = await buildPurchaseTdsDetailRows({
          comp_code,
          comp_uid,
          s_date,
          e_date,
          party_code,
        });
        res.json({ ok: true, rows });
      } catch (err) {
        console.error('❌ purchase-tds-detail error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-tds-summary', async (req, res) => {
      try {
        const { comp_code, comp_uid, s_date, e_date, party_code } = req.query;
        if (!comp_code || comp_uid == null || !s_date || !e_date) {
          return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date required' });
        }
        const rows = await buildPurchaseTdsSummaryRows({
          comp_code,
          comp_uid,
          s_date,
          e_date,
          party_code,
        });
        res.json({ ok: true, rows });
      } catch (err) {
        console.error('❌ purchase-tds-summary error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sale-tds-detail', async (req, res) => {
      try {
        const { comp_code, comp_uid, s_date, e_date, party_code } = req.query;
        if (!comp_code || comp_uid == null || !s_date || !e_date) {
          return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date required' });
        }
        const rows = await buildSaleTdsDetailRows({
          comp_code,
          comp_uid,
          s_date,
          e_date,
          party_code,
        });
        res.json({ ok: true, rows });
      } catch (err) {
        console.error('❌ sale-tds-detail error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sale-tds-summary', async (req, res) => {
      try {
        const { comp_code, comp_uid, s_date, e_date, party_code } = req.query;
        if (!comp_code || comp_uid == null || !s_date || !e_date) {
          return res.status(400).json({ error: 'comp_code, comp_uid, s_date, e_date required' });
        }
        const rows = await buildSaleTdsSummaryRows({
          comp_code,
          comp_uid,
          s_date,
          e_date,
          party_code,
        });
        res.json({ ok: true, rows });
      } catch (err) {
        console.error('❌ sale-tds-summary error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });
  }

  return {
    registerRoutes,
    buildPurchaseTdsDetailRows,
    buildPurchaseTdsSummaryRows,
    buildSaleTdsDetailRows,
    buildSaleTdsSummaryRows,
  };
}

module.exports = { createPurchaseTdsReports };
