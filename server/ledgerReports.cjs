/**
 * Ledger module reports — VFP MYLEGER (ledger Dr/Cr date ranges).
 */

'use strict';

const { inferColumnsFromRows } = require('./incomeTaxReports.cjs');

const REPORT_IDS = ['ledger-dr-cr-date'];

function ledgerDrCrDateWhereSql() {
  return `(
    (NVL(A.DR_AMT, 0) <> 0
      AND A.VR_DATE BETWEEN TO_DATE(:s_date, 'DD-MM-YYYY') AND TO_DATE(:e_date, 'DD-MM-YYYY'))
    OR (NVL(A.DR_AMT, 0) = 0
      AND A.VR_DATE BETWEEN TO_DATE(:cs_date, 'DD-MM-YYYY') AND TO_DATE(:ce_date, 'DD-MM-YYYY'))
  )`;
}

function buildLedgerDrCrDateTxnSelect(voucherWiseTotal) {
  const dateWhere = ledgerDrCrDateWhereSql();
  if (voucherWiseTotal) {
    return `
        SELECT
               A.CODE,
               MAX(B.NAME) AS NAME,
               MAX(B.CITY) AS CITY,
               MAX(B.GST_NO) AS GST_NO,
               MAX(B.PAN) AS PAN,
               MAX(B.ADD1) AS ADD1,
               MAX(B.ADD2) AS ADD2,
               MAX(B.TEL_NO_O) AS TEL_NO_O,
               A.VR_DATE,
               A.V_DATE,
               A.VR_NO,
               A.VR_TYPE,
               A.TYPE,
               0 AS TRN_NO,
               A.DETAIL,
               SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
               SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
               NULL AS DC_CODE,
               NULL AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND ${dateWhere}
        GROUP BY A.CODE, A.VR_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.CHQ_NO, A.DETAIL, A.V_DATE
      `;
  }
  return `
        SELECT A.CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               A.VR_DATE, A.V_DATE, A.VR_NO, A.VR_TYPE, A.TYPE, A.TRN_NO,
               A.DETAIL, A.DR_AMT, A.CR_AMT, A.DC_CODE, D.NAME AS DC_NAME
        FROM LEDGER A
        LEFT JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.DC_CODE = D.CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.CODE = :code
          AND ${dateWhere}
      `;
}

/** Full ledger statement rows (opening balance + RUN_BAL) for MYLEGER date logic. */
async function fetchLedgerDrCrDateRows(
  runQuery,
  comp_code,
  comp_uid,
  code,
  s_date,
  e_date,
  cs_date,
  ce_date,
  voucher_wise_total = 'N'
) {
  const voucherWiseTotal = String(voucher_wise_total || 'N').trim().toUpperCase() === 'Y';
  const txnSelect = buildLedgerDrCrDateTxnSelect(voucherWiseTotal);
  const sql = `
      WITH OP AS (
        SELECT SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OP_BAL
        FROM LEDGER
        WHERE COMP_CODE = :comp_code
          AND CODE = :code
          AND VR_DATE < TO_DATE(:s_date, 'DD-MM-YYYY')
      ),
      DATA AS (
        SELECT :code AS CODE, B.NAME, B.CITY, B.GST_NO, B.PAN, B.ADD1, B.ADD2, B.TEL_NO_O,
               TO_DATE(:s_date,'DD-MM-YYYY') AS VR_DATE,
               CAST(NULL AS DATE) AS V_DATE,
               0 AS VR_NO, 'OP' AS VR_TYPE, NULL AS TYPE, 0 AS TRN_NO, 'OPENING BALANCE' AS DETAIL,
               CASE WHEN OP.OP_BAL > 0 THEN OP.OP_BAL ELSE 0 END AS DR_AMT,
               CASE WHEN OP.OP_BAL < 0 THEN ABS(OP.OP_BAL) ELSE 0 END AS CR_AMT,
               NULL AS DC_CODE, NULL AS DC_NAME
        FROM OP
        LEFT JOIN MASTER B ON B.COMP_CODE = :comp_code AND B.CODE = :code
        UNION ALL
        ${txnSelect}
      )
      SELECT DATA.*,
             SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)) OVER (
               ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS RUN_BAL
      FROM DATA
      ORDER BY VR_DATE, VR_NO, VR_TYPE, TRN_NO`;

  return runQuery(
    sql,
    { comp_code, code, s_date, e_date, cs_date, ce_date },
    comp_uid
  );
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
  return {
    s_date: pick('s_date', 'sdt', 'SDT', 'S_DATE'),
    e_date: pick('e_date', 'edt', 'EDT', 'E_DATE'),
    cs_date: pick('cs_date', 'csdt', 'CSDT', 'CS_DATE'),
    ce_date: pick('ce_date', 'cedt', 'CEDT', 'CE_DATE'),
    mcode: pick('mcode', 'party_code', 'MCODE', 'CODE', 'code'),
    voucher_wise_total: pick('voucher_wise_total', 'voucherWiseTotal') || 'N',
  };
}

function createLedgerReports(runQuery) {
  async function runLedgerDrCrDate(comp_code, comp_uid, p) {
    if (!p.mcode) {
      throw Object.assign(new Error('Account code (mcode) is required'), { status: 400 });
    }
    if (!p.s_date || !p.e_date) {
      throw Object.assign(new Error('Debit from/to dates (sdt, edt) are required'), { status: 400 });
    }
    if (!p.cs_date || !p.ce_date) {
      throw Object.assign(new Error('Credit from/to dates (csdt, cedt) are required'), { status: 400 });
    }
    const rows = await fetchLedgerDrCrDateRows(
      runQuery,
      comp_code,
      comp_uid,
      p.mcode,
      p.s_date,
      p.e_date,
      p.cs_date,
      p.ce_date,
      p.voucher_wise_total
    );
    return {
      rows,
      columns: inferColumnsFromRows(rows),
    };
  }

  const HANDLERS = {
    'ledger-dr-cr-date': runLedgerDrCrDate,
  };

  async function buildLedgerReport(reportId, comp_code, comp_uid, params = {}) {
    const id = String(reportId || '').trim().toLowerCase();
    const handler = HANDLERS[id];
    if (!handler) {
      throw Object.assign(new Error(`Unknown ledger report id: "${reportId}"`), { status: 400 });
    }
    const cc = String(comp_code ?? '').trim();
    if (!cc) throw Object.assign(new Error('comp_code is required'), { status: 400 });
    if (comp_uid == null) throw Object.assign(new Error('comp_uid is required'), { status: 400 });
    const p = normalizeParams(params);
    const result = await handler(cc, comp_uid, p);
    const rows = result.rows ?? [];
    const columns = result.columns ?? inferColumnsFromRows(rows);
    return { rows, columns };
  }

  return { buildLedgerReport };
}

module.exports = {
  createLedgerReports,
  fetchLedgerDrCrDateRows,
  REPORT_IDS,
};
