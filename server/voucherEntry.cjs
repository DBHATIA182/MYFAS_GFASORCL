/**
 * Cash / voucher entry — CRUD for VFP DO FORM voucher (CV first).
 * Factory: createVoucherEntry({ runQuery, parseDateOnly }) → { registerRoutes }
 */

'use strict';

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

function normType(v) {
  const t = String(v ?? 'N').trim().toUpperCase();
  return t || 'N';
}

/** VFP voupnt_cash_a4 — PARTICULARS = ledger code + name (not bill detail alone). */
function formatVoucherPrintParticulars(code, name, detail) {
  const c = normCode(code);
  const n = String(name ?? '').trim();
  const d = String(detail ?? '').trim();
  const ac = [c, n].filter(Boolean).join(' ');
  if (ac) return ac;
  return d || c || n;
}

function entTimeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function computerName(req) {
  const xf = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || 'WEB';
}

function formatDateOut(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const dd = String(raw.getDate()).padStart(2, '0');
    const mm = String(raw.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${raw.getFullYear()}`;
  }
  const s = String(raw).trim();
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dd}-${mm}-${dmy[3]}`;
  }
  return s;
}

function createVoucherEntry({ runQuery, parseDateOnly, withCompTransaction }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createVoucherEntry requires runQuery and parseDateOnly');
  }

  function makeQuery(comp_uid, exec) {
    if (exec) {
      return async (sql, binds = {}) => {
        const result = await exec(sql, binds);
        return result.rows;
      };
    }
    return (sql, binds = {}) => runQuery(sql, binds, comp_uid, { autoCommit: true });
  }

  async function runInCompTx(comp_uid, fn) {
    if (typeof withCompTransaction === 'function') {
      return withCompTransaction(comp_uid, fn);
    }
    return fn(null);
  }

  function lineDate(raw, fallback) {
    if (raw == null || raw === '') return fallback || null;
    return parseDateOnly(raw) || fallback || null;
  }

  function assertDateInFinYear(vdt, fyStart, fyEnd, label) {
    if (!vdt || (!fyStart && !fyEnd)) return;
    const t = vdt.getTime();
    if (fyStart && t < fyStart.getTime()) {
      const err = new Error(
        `${label} is before financial year start (${formatDateOut(fyStart)}).`
      );
      err.status = 400;
      throw err;
    }
    if (fyEnd && t > fyEnd.getTime()) {
      const err = new Error(`${label} is after financial year end (${formatDateOut(fyEnd)}).`);
      err.status = 400;
      throw err;
    }
  }

  async function assertMasterCode(comp_code, code, comp_uid, label) {
    const cc = Number(comp_code) || 0;
    const c = normCode(code);
    if (!c) {
      const err = new Error(`${label || 'Account'} code is required.`);
      err.status = 400;
      throw err;
    }
    const sql = `
      SELECT CODE, NAME, PAN
      FROM MASTER
      WHERE COMP_CODE = :comp_code AND TRIM(CODE) = TRIM(:code)`;
    const rows = await runQuery(sql, { comp_code: cc, code: c }, comp_uid);
    const row = rows?.[0];
    if (!row) {
      const err = new Error(`${label || 'Account'} "${c}" not found in master.`);
      err.status = 400;
      throw err;
    }
    return {
      code: c,
      name: String(row.NAME ?? row.name ?? '').trim(),
      pan: String(row.PAN ?? row.pan ?? '').trim(),
    };
  }

  async function fetchNextVrNo(comp_code, comp_uid, vr_type, vr_date) {
    const cc = Number(comp_code) || 0;
    const vdt = parseDateOnly(vr_date);
    if (!vdt) {
      const err = new Error('Voucher date is required.');
      err.status = 400;
      throw err;
    }
    const sql = `
      SELECT NVL(MAX(VR_NO), 0) AS VR_NO
      FROM VOUCHER
      WHERE COMP_CODE = :comp_code
        AND VR_TYPE = :vr_type
        AND VR_DATE = :vr_date`;
    const rows = await runQuery(sql, { comp_code: cc, vr_type: normCode(vr_type), vr_date: vdt }, comp_uid);
    const vr = Number(rows?.[0]?.VR_NO ?? rows?.[0]?.vr_no ?? 0) || 0;
    return vr + 1;
  }

  async function fetchCashContext(comp_code, comp_uid, vr_date, cb_code, vr_type = 'CV') {
    const cc = Number(comp_code) || 0;
    const vdt = parseDateOnly(vr_date);
    const code = normCode(cb_code);
    const vt = normCode(vr_type) || 'CV';
    let ac_bal = 0;
    let tot_cash = 0;
    if (code) {
      const balRows = await runQuery(
        `SELECT NVL(SUM(NVL(DR_AMT,0) - NVL(CR_AMT,0)), 0) AS AC_BAL
         FROM LEDGER WHERE COMP_CODE = :comp_code AND CODE = :code`,
        { comp_code: cc, code },
        comp_uid
      );
      ac_bal = num(balRows?.[0]?.AC_BAL ?? balRows?.[0]?.ac_bal);
    }
    if (vdt) {
      const totRows = await runQuery(
        `SELECT NVL(SUM(NVL(CR_AMT, 0)), 0) AS TOT_AMT
         FROM VOUCHER
         WHERE COMP_CODE = :comp_code
           AND VR_TYPE = :vr_type
           AND VR_DATE = :vr_date`,
        { comp_code: cc, vr_type: vt, vr_date: vdt },
        comp_uid
      );
      tot_cash = num(totRows?.[0]?.TOT_AMT ?? totRows?.[0]?.tot_amt);
    }
    return { ac_bal, tot_cash, ...(await fetchBillHelpSettings(cc, comp_uid)) };
  }

  /** VFP CV init — MASTER.SCHEDULE = 9.10 */
  async function fetchDefaultCashAccount(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT CODE, NAME
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ROUND(NVL(SCHEDULE, 0), 2) = 9.10
      ORDER BY CODE`;
    const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
    if (!rows?.length) return { code: '', name: '' };
    return {
      code: normCode(rows[0].CODE ?? rows[0].code),
      name: String(rows[0].NAME ?? rows[0].name ?? '').trim(),
    };
  }

  /** VFP BV init — MASTER.SCHEDULE = 9.20 */
  async function fetchDefaultBankAccount(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT CODE, NAME
      FROM MASTER
      WHERE COMP_CODE = :comp_code
        AND ROUND(NVL(SCHEDULE, 0), 2) = 9.20
      ORDER BY CODE`;
    const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
    if (!rows?.length) return { code: '', name: '' };
    return {
      code: normCode(rows[0].CODE ?? rows[0].code),
      name: String(rows[0].NAME ?? rows[0].name ?? '').trim(),
    };
  }

  /** Cost centre browse — F1 on Cost column (VFP COST table). */
  async function fetchCostHelp(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT TRIM(COST_NAME) AS COST_NAME, TRIM(COST_CODE) AS COST_CODE
      FROM COST
      WHERE COMP_CODE = :comp_code
      ORDER BY COST_NAME`;
    const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
    return (rows || []).map((r) => ({
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      cost_name: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
      COST_CODE: normCode(r.COST_CODE ?? r.cost_code),
      COST_NAME: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
    }));
  }

  /** VFP LOTHLP — LOTSTOCK browse (PU/PC, exclude BIKRI B_NO). */
  async function fetchLotHelp(comp_code, comp_uid, party_code, remarks = '') {
    const cc = Number(comp_code) || 0;
    const party = normCode(party_code);
    if (!party) {
      const err = new Error('Enter party code on this line first.');
      err.status = 400;
      throw err;
    }

    const bikriRows = await runQuery(
      `SELECT B_NO FROM BIKRI WHERE COMP_CODE = :comp_code`,
      { comp_code: cc },
      comp_uid
    ).catch(() => []);
    const bikriBnos = new Set(
      (bikriRows || [])
        .map((r) => Number(r.B_NO ?? r.b_no ?? 0) || 0)
        .filter((n) => n > 0)
    );

    const rem = String(remarks ?? '').trim().toUpperCase();
    const first = party.charAt(0);

    if (first === 'S' || first === 'T') {
      const sql = `
        SELECT
          A.B_NO,
          A.ITEM_CODE,
          B.ITEM_NAME,
          A.LOT,
          NVL(A.QNTY, 0) AS QNTY,
          A.VR_DATE AS R_DATE,
          NVL(A.REMARKS, ' ') AS REMARKS
        FROM LOTSTOCK A
        INNER JOIN ITEMMAST B
          ON A.COMP_CODE = B.COMP_CODE
         AND A.ITEM_CODE = B.ITEM_CODE
        WHERE A.COMP_CODE = :comp_code
          AND A.VR_TYPE IN ('PU', 'PC')
          AND TRIM(A.SUP_CODE) = TRIM(:party_code)
        ORDER BY A.B_NO, A.ITEM_CODE, A.LOT`;
      let rows = await runQuery(sql, { comp_code: cc, party_code: party }, comp_uid);
      rows = (rows || []).filter((r) => !bikriBnos.has(Number(r.B_NO ?? r.b_no ?? 0) || 0));
      if (rem) {
        rows = rows.filter((r) =>
          String(r.REMARKS ?? r.remarks ?? '')
            .toUpperCase()
            .includes(rem)
        );
      }
      const mapped = rows.map((r, idx) => ({
        _id: `${r.B_NO ?? r.b_no}-${r.ITEM_CODE ?? r.item_code}-${r.LOT ?? r.lot}-${idx}`,
        b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        lot: String(r.LOT ?? r.lot ?? '').trim(),
        qnty: num(r.QNTY ?? r.qnty),
        r_date: formatDateOut(r.R_DATE ?? r.r_date),
        remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      }));
      return { style: 'supplier', rows: mapped };
    }

    const sql = `
      SELECT
        NVL(B.NAME, ' ') AS SUP_NAME,
        TRIM(NVL(A.MSUP_CODE, ' ')) AS MSUP_CODE,
        NVL(C.NAME, ' ') AS TDG_NAME,
        TRIM(NVL(A.SUP_CODE, ' ')) AS TDG_CODE,
        NVL(A.B_NO, 0) AS B_NO,
        A.ITEM_CODE,
        A.LOT
      FROM LOTSTOCK A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND TRIM(NVL(A.MSUP_CODE, ' ')) = TRIM(B.CODE)
      LEFT JOIN MASTER C
        ON A.COMP_CODE = C.COMP_CODE
       AND TRIM(A.SUP_CODE) = TRIM(C.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND A.VR_TYPE IN ('PU', 'PC')
      GROUP BY
        A.MSUP_CODE, B.NAME, A.SUP_CODE, C.NAME,
        A.B_NO, A.ITEM_CODE, A.LOT
      ORDER BY B.NAME, A.B_NO`;
    let rows = await runQuery(sql, { comp_code: cc }, comp_uid);
    rows = (rows || []).filter((r) => !bikriBnos.has(Number(r.B_NO ?? r.b_no ?? 0) || 0));
    const mapped = rows.map((r, idx) => {
      const itemCode = Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0;
      const lot = String(r.LOT ?? r.lot ?? '').trim();
      return {
        _id: `trader-${r.B_NO ?? r.b_no}-${itemCode}-${lot}-${idx}`,
        sup_name: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
        sup_code: String(r.MSUP_CODE ?? r.msup_code ?? '').trim(),
        tdg_name: String(r.TDG_NAME ?? r.tdg_name ?? '').trim(),
        tdg_code: String(r.TDG_CODE ?? r.tdg_code ?? '').trim(),
        b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
        item_code: itemCode,
        lot,
        lot_label: `${itemCode}-${lot}`,
      };
    });
    return { style: 'trader', rows: mapped };
  }

  /** VFP bill_hlp — outstanding bills for party (F1 on Bill Date column). */
  async function fetchBillHelp(comp_code, comp_uid, party_code, vr_date) {
    const cc = Number(comp_code) || 0;
    const party = normCode(party_code);
    if (!party) {
      const err = new Error('Enter party code on this line first.');
      err.status = 400;
      throw err;
    }
    const vdt = parseDateOnly(vr_date);
    const schRows = await runQuery(
      `SELECT NVL(SCHEDULE, 0) AS SCHEDULE FROM MASTER WHERE COMP_CODE = :comp_code AND CODE = :code`,
      { comp_code: cc, code: party },
      comp_uid
    );
    const sch = num(schRows?.[0]?.SCHEDULE ?? schRows?.[0]?.schedule);
    const isSupplier = sch >= 11;
    const balExpr = isSupplier
      ? 'NVL(CR_AMT, 0) - NVL(DR_AMT, 0)'
      : 'NVL(DR_AMT, 0) - NVL(CR_AMT, 0)';
    const sql = `
      SELECT
        A.BILL_DATE,
        A.BILL_NO,
        NVL(A.B_TYPE, ' ') AS B_TYPE,
        SUM(NVL(A.DR_AMT, 0)) AS DR_AMT,
        SUM(NVL(A.CR_AMT, 0)) AS CR_AMT,
        SUM(${balExpr}) AS CUR_BAL,
        MAX(A.BK_CODE) AS BK_CODE
      FROM BILLS A
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.CODE) = TRIM(:party_code)
      GROUP BY A.BILL_DATE, A.BILL_NO, NVL(A.B_TYPE, ' ')
      HAVING SUM(${balExpr}) <> 0
      ORDER BY A.BILL_DATE, A.BILL_NO, NVL(A.B_TYPE, ' ')`;
    const rows = await runQuery(sql, { comp_code: cc, party_code: party }, comp_uid);
    return (rows || []).map((r, idx) => ({
      _id: `${formatDateOut(r.BILL_DATE ?? r.bill_date)}-${r.BILL_NO ?? r.bill_no}-${idx}`,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      b_type: String(r.B_TYPE ?? r.b_type ?? ' ').trim() || ' ',
      dr_amt: num(r.DR_AMT ?? r.dr_amt),
      cr_amt: num(r.CR_AMT ?? r.cr_amt),
      cur_bal: num(r.CUR_BAL ?? r.cur_bal),
      bk_code: normCode(r.BK_CODE ?? r.bk_code),
    }));
  }

  /** VFP Billhlp — INT(SCHEDULE) = 11 uses GETINT_SUP with swapped Dr/Cr. */
  function scheduleIsSupplier(sch) {
    const n = Number(sch);
    if (!Number.isFinite(n)) return false;
    return Math.floor(n) === 11;
  }

  function scheduleIsCustomerDebtor(sch) {
    const n = Number(sch);
    if (!Number.isFinite(n)) return false;
    return Math.floor(n) === 8;
  }

  /** VFP Billhlp — grid IND_YN (I/F/Y); not MASTER. I=indent, F=freight, else schedule. */
  function normalizeBillHelpIndYn(raw) {
    return String(raw ?? '').trim().toUpperCase();
  }

  function resolveBillHelpQueryProfile(schedule, indYn) {
    const ind = normalizeBillHelpIndYn(indYn);
    if (ind === 'I') {
      return { isSupplier: false, indYn: 'I', vDateVrTypes: ['IN', 'OP'] };
    }
    if (ind === 'F') {
      return { isSupplier: true, indYn: 'F', vDateVrTypes: ['SL', 'OP', 'JF', 'SE'] };
    }
    const isSupplier = scheduleIsSupplier(schedule);
    return {
      isSupplier,
      indYn: ind,
      vDateVrTypes: isSupplier ? ['PU', 'OP'] : ['SL', 'OP', 'SE'],
    };
  }

  const voucherIndYnCache = new Map();

  async function voucherSupportsIndYn(comp_uid) {
    const key = String(comp_uid ?? '').trim() || '__default__';
    if (voucherIndYnCache.has(key)) return voucherIndYnCache.get(key);
    try {
      await runQuery(
        `SELECT TRIM(NVL(IND_YN, ' ')) AS IND_YN FROM VOUCHER WHERE ROWNUM = 1`,
        {},
        comp_uid,
        { suppressDbErrorLog: true }
      );
      voucherIndYnCache.set(key, true);
      return true;
    } catch (err) {
      if (/IND_YN|invalid identifier|ORA-00904/i.test(String(err?.message || ''))) {
        voucherIndYnCache.set(key, false);
        return false;
      }
      throw err;
    }
  }

  async function fetchPartyBillHelpMeta(comp_code, comp_uid, code) {
    const cc = Number(comp_code) || 0;
    const party = normCode(code);
    const binds = { comp_code: cc, code: party };
    const rows = await runQuery(
      `SELECT NVL(SCHEDULE, 0) AS SCHEDULE
       FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = TRIM(:code)`,
      binds,
      comp_uid
    );
    return {
      schedule: num(rows?.[0]?.SCHEDULE ?? rows?.[0]?.schedule),
    };
  }

  async function fetchBillHelpSettings(comp_code, comp_uid) {
    const binds = { comp_code: Number(comp_code) || 0 };
    const fullSql = `
      SELECT NVL(PND_BILLS, 0) AS PND_BILLS,
             NVL(VOU_INT_SHOW, 'Y') AS VOU_INT_SHOW,
             NVL(PENDING_VOU_ZERO_YN, 'N') AS PENDING_VOU_ZERO_YN,
             NVL(CD_LESS, 'N') AS CD_LESS,
             NVL(CD_IN_VOU, 'N') AS CD_IN_VOU,
             NVL(B_CODE_IN_VOU, 'N') AS B_CODE_IN_VOU,
             NVL(INDENT_YN, 'N') AS INDENT_YN,
             NVL(AUTO_INT_TRF, 'N') AS AUTO_INT_TRF,
             TRIM(NVL(INT_TRF_CODE, ' ')) AS INT_TRF_CODE,
             TRIM(NVL(CD_CODE, ' ')) AS CD_CODE
      FROM DEFVALUE WHERE COMP_CODE = :comp_code`;
    const baseSql = `
      SELECT NVL(PND_BILLS, 0) AS PND_BILLS,
             NVL(VOU_INT_SHOW, 'Y') AS VOU_INT_SHOW,
             NVL(PENDING_VOU_ZERO_YN, 'N') AS PENDING_VOU_ZERO_YN,
             NVL(CD_LESS, 'N') AS CD_LESS
      FROM DEFVALUE WHERE COMP_CODE = :comp_code`;
    const sqlCandidates = [fullSql, baseSql.replace('DEFVALUE', '"DEFAULT"')];
    const defaults = {
      pnd_bills: 0,
      vou_int_show: 'Y',
      pending_zero_yn: 'N',
      cd_less: 'N',
      cd_in_vou: 'N',
      b_code_in_vou: 'N',
      indent_yn: 'N',
      auto_int_trf: 'N',
      int_trf_code: '',
      cd_code: 'E00000',
    };
    const mapRow = (row) => {
      const pick = (up, low) => row?.[up] ?? row?.[low];
      return {
        pnd_bills: num(pick('PND_BILLS', 'pnd_bills')),
        vou_int_show: String(pick('VOU_INT_SHOW', 'vou_int_show') ?? 'Y').trim().toUpperCase() || 'Y',
        pending_zero_yn: String(pick('PENDING_VOU_ZERO_YN', 'pending_zero_yn') ?? 'N').trim().toUpperCase() || 'N',
        cd_less: String(pick('CD_LESS', 'cd_less') ?? 'N').trim().toUpperCase() || 'N',
        cd_in_vou: String(pick('CD_IN_VOU', 'cd_in_vou') ?? 'N').trim().toUpperCase() || 'N',
        b_code_in_vou: String(pick('B_CODE_IN_VOU', 'b_code_in_vou') ?? 'N').trim().toUpperCase() || 'N',
        indent_yn: String(pick('INDENT_YN', 'indent_yn') ?? 'N').trim().toUpperCase() || 'N',
        auto_int_trf: String(pick('AUTO_INT_TRF', 'auto_int_trf') ?? 'N').trim().toUpperCase() || 'N',
        int_trf_code: normCode(pick('INT_TRF_CODE', 'int_trf_code')),
        cd_code: normCode(pick('CD_CODE', 'cd_code')) || 'E00000',
      };
    };
    for (const sql of sqlCandidates) {
      try {
        const rows = await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
        if (rows?.[0]) return mapRow(rows[0]);
      } catch (_) {}
    }
    return defaults;
  }

  function billDateBind(raw) {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    const d = parseDateOnly(formatDateOut(raw) || raw);
    return d || raw;
  }

  function parseOraGetintReturn(raw) {
    if (raw == null) return { interestDays: null, interestAmt: null };
    const s = String(raw).trim();
    if (!s) return { interestDays: null, interestAmt: null };
    // VFP Billhlp: VAL(SUBSTR(I_AMT,1,5)) days, VAL(SUBSTR(I_AMT,7,20)) interest.
    if (s.length >= 7) {
      const dayStr = s.slice(0, 5).trim();
      const amtStr = s.slice(6, 26).trim().replace(/,/g, '');
      const interestDays = parseInt(dayStr, 10);
      const interestAmt = parseFloat(amtStr);
      if (Number.isFinite(interestAmt)) {
        return {
          interestDays: Number.isFinite(interestDays) ? interestDays : null,
          interestAmt,
        };
      }
    }
    const i = s.search(/I/i);
    if (i < 1) return { interestDays: null, interestAmt: null };
    const dayStr = s.slice(0, i).trim();
    const amtStr = s.slice(i + 1).trim().replace(/,/g, '');
    const interestDays = parseInt(dayStr, 10);
    const interestAmt = parseFloat(amtStr);
    return {
      interestDays: Number.isFinite(interestDays) ? interestDays : null,
      interestAmt: Number.isFinite(interestAmt) ? interestAmt : null,
    };
  }

  async function fetchBillLedgerIntDefaults(comp_code, comp_uid) {
    const binds = { comp_code: Number(comp_code) || 0 };
    const sqlCandidates = [
      `SELECT G_DAYS, G_EDAYS FROM DEFVALUE WHERE COMP_CODE = :comp_code`,
      `SELECT G_DAYS, G_EDAYS FROM DEFAULT WHERE COMP_CODE = :comp_code`,
      `SELECT G_DAYS, G_EDAYS FROM "DEFAULT" WHERE COMP_CODE = :comp_code`,
    ];
    for (const sql of sqlCandidates) {
      try {
        const rows = await runQuery(sql, binds, comp_uid, { suppressDbErrorLog: true });
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        if (row) {
          const pick = (up, low) => row?.[up] ?? row?.[low] ?? null;
          return {
            gs_days: pick('G_DAYS', 'g_days') ?? 0,
            ged_days: pick('G_EDAYS', 'g_edays') ?? 30,
          };
        }
      } catch (_) {}
    }
    return { gs_days: 0, ged_days: 30 };
  }

  /** VFP Billhlp BX0 filter — schedule 8 uses optional interest in threshold. */
  function pendingBillPassesFilter(r, { isCustomer8, minBal, vouIntShow, pendingZeroYn, indYn }) {
    const curBal = num(r.CUR_BAL ?? r.cur_bal);
    const intAmt = num(r.INT_AMT ?? r.int_amt);
    const threshold = num(minBal);
    const showInt = String(vouIntShow ?? 'Y').toUpperCase() === 'Y';
    const allowZero = String(pendingZeroYn ?? 'N').toUpperCase() === 'Y';
    const ind = String(indYn ?? '').toUpperCase();

    if (isCustomer8 && ind !== 'F') {
      const effective = showInt ? curBal + intAmt : curBal;
      if (effective <= threshold) return false;
      if (!allowZero && curBal === 0) return false;
      return effective > threshold;
    }
    if (curBal === 0) return false;
    return curBal > threshold;
  }

  /** VFP BillHlp — pending bills with optional GETINT (VARCHAR2 party codes). */
  async function queryVoucherPendingBillRows(
    comp_code,
    comp_uid,
    code,
    { schedule, indYn, vd, minBal, vouIntShow }
  ) {
    const party = normCode(code);
    const cc = Number(comp_code) || 0;
    const profile = resolveBillHelpQueryProfile(schedule, indYn);
    const { isSupplier, vDateVrTypes } = profile;
    const bTypeExpr = isSupplier ? `NVL(A.B_TYPE, 'Z')` : `NVL(A.B_TYPE, ' ')`;
    const drExpr = isSupplier ? `SUM(NVL(A.CR_AMT, 0))` : `SUM(NVL(A.DR_AMT, 0))`;
    const crExpr = isSupplier ? `SUM(NVL(A.DR_AMT, 0))` : `SUM(NVL(A.CR_AMT, 0))`;
    const curBalExpr = isSupplier
      ? `SUM(NVL(A.CR_AMT, 0) - NVL(A.DR_AMT, 0))`
      : `SUM(NVL(A.DR_AMT, 0) - NVL(A.CR_AMT, 0))`;
    const vDateList = vDateVrTypes.map((t) => `'${t}'`).join(', ');
    const vDateExpr = `MAX(CASE WHEN TRIM(NVL(A.VR_TYPE, ' ')) IN (${vDateList}) THEN A.V_DATE END)`;
    const payFilter = vd
      ? `AND (TRIM(NVL(A.VR_TYPE, ' ')) NOT IN ('CV', 'BV', 'JV') OR A.VR_DATE <= TO_DATE(:v_date, 'DD-MM-YYYY'))`
      : '';
    const baseBinds = { comp_code: cc, code: party };
    if (vd) baseBinds.v_date = vd;
    const binds = { ...baseBinds };

    const billBalCte = `
    WITH bill_bal AS (
      SELECT
        A.BILL_DATE,
        A.BILL_NO,
        ${bTypeExpr} AS B_TYPE,
        ${drExpr} AS DR_AMT,
        ${crExpr} AS CR_AMT,
        ${curBalExpr} AS CUR_BAL,
        ${vDateExpr} AS V_DATE,
        MAX(NVL(A.DAYS, 0)) AS DAYS,
        MAX(TRIM(A.BK_CODE)) AS BK_CODE,
        MAX(TRIM(A.CODE)) AS CODE,
        MAX(NVL(A.DEMAND_NO, 0)) AS DEMAND_NO,
        MAX(NVL(A.FORWARDING_NO, 0)) AS FORWARDING_NO,
        MAX(TRIM(A.TRN_ID)) AS TRN_ID,
        MAX(TRIM(A.FOIS_TRN_ID)) AS FOIS_TRN_ID,
        MAX(TRIM(A.TRUCK_NO)) AS TRUCK_NO,
        MAX(TRIM(A.CUSTOMER_CODE)) AS CUSTOMER_CODE,
        MAX(TRIM(A.RST_NO)) AS RST_NO,
        MAX(TRIM(A.GOD_CODE_F)) AS GOD_CODE_F,
        MAX(TRIM(A.GOD_CODE_T)) AS GOD_CODE_T,
        MAX(NVL(A.ITEM_CODE, 0)) AS ITEM_CODE,
        MAX(NVL(A.PCD_PER, 0)) AS PCD_PER
      FROM BILLS A
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.CODE) = TRIM(:code)
        ${payFilter}
      GROUP BY A.BILL_DATE, A.BILL_NO, ${bTypeExpr}
      HAVING MAX(CASE WHEN SUBSTR(NVL(A.DETAIL, ' '), 1, 1) = '*' THEN 1 ELSE 0 END) = 0
    )`;

    const wantInt = String(vouIntShow ?? 'Y').toUpperCase() === 'Y' && !!vd;
    let sql;
    if (wantInt) {
      const intDefaults = await fetchBillLedgerIntDefaults(cc, comp_uid);
      binds.int_indt = vd;
      binds.e_date = vd;
      binds.gs_days = String(intDefaults.gs_days ?? 0);
      binds.ged_days = String(intDefaults.ged_days ?? 30);
      binds.group_cd = '0';
      binds.bombay_dhara = '0';
      binds.comp_code_gi = String(cc).trim();
      binds.p_edt = vd;
      const getintSql = isSupplier
        ? `GETINT_SUP(
            TO_NUMBER(TRIM(:comp_code_gi)),
            TRIM(bb.CODE),
            bb.BILL_DATE,
            bb.BILL_NO,
            NVL(TRIM(bb.B_TYPE), 'Z'),
            TO_DATE(:int_indt, 'DD-MM-YYYY'),
            TO_NUMBER(:gs_days),
            TO_NUMBER(:ged_days),
            TO_NUMBER(:group_cd),
            TO_NUMBER(:bombay_dhara),
            TO_DATE(:e_date, 'DD-MM-YYYY')
          )`
        : `GETINT(
            TO_NUMBER(TRIM(:comp_code_gi)),
            TRIM(bb.CODE),
            bb.BILL_DATE,
            bb.BILL_NO,
            TRIM(bb.B_TYPE),
            TO_DATE(:int_indt, 'DD-MM-YYYY'),
            TO_NUMBER(:gs_days),
            TO_NUMBER(:ged_days),
            TO_NUMBER(:group_cd),
            TO_NUMBER(:bombay_dhara),
            TO_DATE(:e_date, 'DD-MM-YYYY'),
            TO_DATE(:p_edt, 'DD-MM-YYYY')
          )`;
      sql =
        billBalCte +
        `
    SELECT
      bb.BILL_DATE,
      bb.BILL_NO,
      bb.B_TYPE,
      bb.DR_AMT,
      bb.CR_AMT,
      bb.CUR_BAL,
      bb.V_DATE,
      bb.DAYS,
      bb.BK_CODE,
      ${getintSql} AS GETINT_RAW
    FROM bill_bal bb
    ORDER BY bb.BILL_DATE, bb.BILL_NO, bb.B_TYPE`;
    } else {
      sql =
        billBalCte +
        `
    SELECT
      bb.BILL_DATE,
      bb.BILL_NO,
      bb.B_TYPE,
      bb.DR_AMT,
      bb.CR_AMT,
      bb.CUR_BAL,
      bb.V_DATE,
      bb.DAYS,
      bb.BK_CODE
    FROM bill_bal bb
    ORDER BY bb.BILL_DATE, bb.BILL_NO, bb.B_TYPE`;
    }

    const runPending = async (schema) => {
      try {
        return await runQuery(sql, binds, schema);
      } catch (e) {
        const msg = String(e.message || '');
        if (
          wantInt &&
          /GETINT|ORA-00904|ORA-01036|invalid identifier|unrecognized bind variable/i.test(msg)
        ) {
          const fallbackSql =
            billBalCte +
            `
    SELECT
      bb.BILL_DATE,
      bb.BILL_NO,
      bb.B_TYPE,
      bb.DR_AMT,
      bb.CR_AMT,
      bb.CUR_BAL,
      bb.V_DATE,
      bb.DAYS,
      bb.BK_CODE
    FROM bill_bal bb
    ORDER BY bb.BILL_DATE, bb.BILL_NO, bb.B_TYPE`;
          return await runQuery(fallbackSql, baseBinds, schema);
        }
        throw e;
      }
    };

    let rows = await runPending(comp_uid);
    if ((!rows || rows.length === 0) && comp_uid) {
      rows = await runPending(null);
    }
    return rows || [];
  }

  /** Per-bill GETINT when main BillHlp query falls back without interest (GFASORCL bill-ledger parity). */
  async function fetchBillInterestForRow(comp_code, comp_uid, party, row, vd, isSupplier) {
    const cc = Number(comp_code) || 0;
    if (!vd || !row) return { interestAmt: 0, interestDays: 0 };
    const intDefaults = await fetchBillLedgerIntDefaults(cc, comp_uid);
    const bTypeRaw = row.B_TYPE ?? row.b_type;
    const bType = isSupplier
      ? String(bTypeRaw ?? 'Z').trim() || 'Z'
      : String(bTypeRaw ?? ' ').trim() || ' ';
    const billDate = billDateBind(row.BILL_DATE ?? row.bill_date);
    const billNo = Number(row.BILL_NO ?? row.bill_no) || 0;
    const binds = {
      comp_code_gi: String(cc).trim(),
      code: normCode(party),
      bill_date: billDate,
      bill_no: billNo,
      b_type: bType,
      int_indt: vd,
      e_date: vd,
      p_edt: vd,
      gs_days: String(intDefaults.gs_days ?? 0),
      ged_days: String(intDefaults.ged_days ?? 30),
      group_cd: '0',
      bombay_dhara: '0',
    };
    const billDateSql = billDate instanceof Date ? ':bill_date' : `TO_DATE(:bill_date, 'DD-MM-YYYY')`;
    const billDateParam =
      billDate instanceof Date ? billDate : formatDateOut(parseDateOnly(billDate) || billDate);
    binds.bill_date = billDateParam;
    binds.bill_no = billNo;
    const fnSql = isSupplier
      ? `GETINT_SUP(
          TO_NUMBER(TRIM(:comp_code_gi)),
          TRIM(:code),
          ${billDateSql},
          :bill_no,
          TRIM(:b_type),
          TO_DATE(:int_indt, 'DD-MM-YYYY'),
          TO_NUMBER(:gs_days),
          TO_NUMBER(:ged_days),
          TO_NUMBER(:group_cd),
          TO_NUMBER(:bombay_dhara),
          TO_DATE(:e_date, 'DD-MM-YYYY')
        )`
      : `GETINT(
          TO_NUMBER(TRIM(:comp_code_gi)),
          TRIM(:code),
          ${billDateSql},
          :bill_no,
          TRIM(:b_type),
          TO_DATE(:int_indt, 'DD-MM-YYYY'),
          TO_NUMBER(:gs_days),
          TO_NUMBER(:ged_days),
          TO_NUMBER(:group_cd),
          TO_NUMBER(:bombay_dhara),
          TO_DATE(:e_date, 'DD-MM-YYYY'),
          TO_DATE(:p_edt, 'DD-MM-YYYY')
        )`;
    try {
      const rows = await runQuery(`SELECT ${fnSql} AS GETINT_RAW FROM DUAL`, binds, comp_uid);
      return parseOraGetintReturn(rows?.[0]?.GETINT_RAW ?? rows?.[0]?.getint_raw);
    } catch (_) {
      try {
        const rows = await runQuery(`SELECT ${fnSql} AS GETINT_RAW FROM DUAL`, binds, null);
        return parseOraGetintReturn(rows?.[0]?.GETINT_RAW ?? rows?.[0]?.getint_raw);
      } catch (e2) {
        return { interestAmt: 0, interestDays: 0 };
      }
    }
  }

  async function fetchPendingBills(
    comp_code,
    comp_uid,
    code,
    schedule,
    vr_date,
    pnd_bills,
    vou_int_show,
    pending_zero_yn,
    truck_no,
    rst_no,
    ind_yn
  ) {
    const party = normCode(code);
    if (!party) {
      const err = new Error('Party code is required.');
      err.status = 400;
      throw err;
    }
    const cc = Number(comp_code) || 0;
    const meta = await fetchPartyBillHelpMeta(cc, comp_uid, party);
    let sch = Number(schedule);
    if (!Number.isFinite(sch) || sch === 0) sch = meta.schedule;
    const indYn = normalizeBillHelpIndYn(ind_yn);
    const profile = resolveBillHelpQueryProfile(sch, indYn);
    const settings =
      pnd_bills == null || vou_int_show == null || pending_zero_yn == null
        ? await fetchBillHelpSettings(cc, comp_uid)
        : null;
    const minBal = num(pnd_bills ?? settings?.pnd_bills);
    const vd = vr_date ? formatDateOut(parseDateOnly(vr_date) || vr_date) : '';
    const vouIntShow =
      String(vou_int_show ?? settings?.vou_int_show ?? 'Y').trim().toUpperCase() || 'Y';
    const pendingZeroYn =
      String(pending_zero_yn ?? settings?.pending_zero_yn ?? 'N').trim().toUpperCase() || 'N';
    const isCustomer8 = scheduleIsCustomerDebtor(sch);

    const rawRows = await queryVoucherPendingBillRows(cc, comp_uid, party, {
      schedule: sch,
      indYn,
      vd,
      minBal,
      vouIntShow,
    });

    const filterOpts = { isCustomer8, minBal, vouIntShow, pendingZeroYn, indYn };
    const wantInt = String(vouIntShow ?? 'Y').toUpperCase() === 'Y' && !!vd;
    const out = [];
    for (const r of rawRows) {
      let parsed = parseOraGetintReturn(r.GETINT_RAW ?? r.getint_raw);
      if (wantInt && (parsed.interestAmt == null || parsed.interestAmt === 0)) {
        const extra = await fetchBillInterestForRow(cc, comp_uid, party, r, vd, profile.isSupplier);
        if (extra.interestAmt != null && extra.interestAmt > 0) parsed = extra;
        else if (extra.interestDays != null && parsed.interestDays == null) {
          parsed = { ...parsed, interestDays: extra.interestDays };
        }
      }
      const intAmt = parsed.interestAmt ?? 0;
      const intDays = parsed.interestDays ?? 0;
      const curBal = num(r.CUR_BAL ?? r.cur_bal);
      const total = curBal + intAmt;
      const row = {
        BILL_DATE: r.BILL_DATE ?? r.bill_date,
        BILL_NO: r.BILL_NO ?? r.bill_no,
        B_TYPE: String(r.B_TYPE ?? r.b_type ?? ' ').trim() || (profile.isSupplier ? 'Z' : ' '),
        DR_AMT: r.DR_AMT ?? r.dr_amt,
        CR_AMT: r.CR_AMT ?? r.cr_amt,
        CUR_BAL: curBal,
        V_DATE: r.V_DATE ?? r.v_date,
        DAYS: r.DAYS ?? r.days,
        BK_CODE: String(r.BK_CODE ?? r.bk_code ?? '').trim(),
        INT_AMT: intAmt,
        IDAYS: intDays,
        ADJ_AMT: 0,
        TOTAL: total,
        BAL_AMT: total,
        GTOT_AMT: 0,
        DEMAND_NO: r.DEMAND_NO ?? r.demand_no,
        FORWARDING_NO: r.FORWARDING_NO ?? r.forwarding_no,
        TRN_ID: String(r.TRN_ID ?? r.trn_id ?? '').trim(),
        FOIS_TRN_ID: String(r.FOIS_TRN_ID ?? r.fois_trn_id ?? '').trim(),
        TRUCK_NO: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
        CUSTOMER_CODE: String(r.CUSTOMER_CODE ?? r.customer_code ?? '').trim(),
        RST_NO: String(r.RST_NO ?? r.rst_no ?? '').trim(),
        GOD_CODE_F: String(r.GOD_CODE_F ?? r.god_code_f ?? '').trim(),
        GOD_CODE_T: String(r.GOD_CODE_T ?? r.god_code_t ?? '').trim(),
        ITEM_CODE: r.ITEM_CODE ?? r.item_code,
        PCD_PER: r.PCD_PER ?? r.pcd_per,
      };
      if (pendingBillPassesFilter(row, filterOpts)) out.push(row);
    }

    let filtered = out;
    const truck = String(truck_no ?? '').trim();
    const rst = String(rst_no ?? '').trim();
    if (profile.indYn === 'F' && truck) {
      filtered = filtered.filter((r) => String(r.TRUCK_NO ?? '').trim() === truck);
    }
    if (profile.indYn === 'F' && rst) {
      filtered = filtered.filter((r) => String(r.RST_NO ?? '').trim() === rst);
    }
    return filtered;
  }

  const VOUCHER_LOAD_DATE_WHERE = `TRUNC(A.VR_DATE) = TO_DATE(:vr_date_str, 'DD-MM-YYYY')`;

  /** LEDGER has fewer columns than VOUCHER (no R_C_NO, B_NO, B_TYPE, INT_AMT, CD_AMT). */
  const LEDGER_LOAD_EXTRA_COLS = `
        CAST(' ' AS VARCHAR2(1)) AS B_TYPE,
        0 AS INT_AMT,
        0 AS CD_AMT,
        0 AS R_C_NO,
        0 AS B_NO`;

  function voucherLoadSqlFromLedgerMirror() {
    return `
      SELECT
        A.VR_TYPE,
        A.VR_DATE,
        A.VR_NO,
        A.TYPE,
        A.TRN_NO,
        TRIM(A.DC_CODE) AS CODE,
        B.NAME,
        B.PAN,
        NVL(A.CR_AMT, 0) AS DR_AMT,
        NVL(A.DR_AMT, 0) AS CR_AMT,
        A.DETAIL,
        TRIM(A.CODE) AS DC_CODE,
        A.V_DATE,
        A.LOT,
        A.CHQ_NO,
        A.BILL_DATE,
        A.BILL_NO,
        ${LEDGER_LOAD_EXTRA_COLS},
        A.BK_CODE,
        A.COST_CODE
      FROM LEDGER A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND TRIM(A.DC_CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.VR_TYPE) = :vr_type
        AND ${VOUCHER_LOAD_DATE_WHERE}
        AND A.VR_NO = :vr_no
      ORDER BY A.TRN_NO`;
  }

  function voucherLoadSql(tableName, includeIndYn) {
    const isLedger = tableName === 'LEDGER';
    const tbl = isLedger ? 'LEDGER' : 'VOUCHER';
    const indCol = !isLedger && includeIndYn ? ',\n        A.IND_YN' : '';
    const extraCols = isLedger
      ? LEDGER_LOAD_EXTRA_COLS
      : `
        A.B_TYPE,
        A.INT_AMT,
        A.CD_AMT,
        A.R_C_NO,
        A.B_NO`;
    return `
      SELECT
        A.VR_TYPE,
        A.VR_DATE,
        A.VR_NO,
        A.TYPE,
        A.TRN_NO,
        A.CODE,
        B.NAME,
        B.PAN,
        A.DR_AMT,
        A.CR_AMT,
        A.DETAIL${indCol},
        A.DC_CODE,
        A.V_DATE,
        A.LOT,
        A.CHQ_NO,
        A.BILL_DATE,
        A.BILL_NO,
        ${extraCols},
        A.BK_CODE,
        A.COST_CODE
      FROM ${tbl} A
      LEFT JOIN MASTER B
        ON A.COMP_CODE = B.COMP_CODE
       AND A.CODE = B.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.VR_TYPE) = :vr_type
        AND ${VOUCHER_LOAD_DATE_WHERE}
        AND A.VR_NO = :vr_no
      ORDER BY A.TRN_NO`;
  }

  function mapVoucherLoadRows(rows) {
    return rows.map((r) => ({
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
      code: normCode(r.CODE ?? r.code),
      name: String(r.NAME ?? r.name ?? '').trim(),
      pan: String(r.PAN ?? r.pan ?? '').trim(),
      dc_code: normCode(r.DC_CODE ?? r.dc_code),
      dr_amt: num(r.DR_AMT ?? r.dr_amt),
      cr_amt: num(r.CR_AMT ?? r.cr_amt),
      detail: String(r.DETAIL ?? r.detail ?? '').trim(),
      ind_yn: normalizeBillHelpIndYn(r.IND_YN ?? r.ind_yn),
      v_date: formatDateOut(r.V_DATE ?? r.v_date ?? ''),
      lot: String(r.LOT ?? r.lot ?? '').trim(),
      chq_no: String(r.CHQ_NO ?? r.chq_no ?? '').trim(),
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date ?? ''),
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      b_type: String(r.B_TYPE ?? r.b_type ?? '').trim(),
      int_amt: num(r.INT_AMT ?? r.int_amt),
      cd_amt: num(r.CD_AMT ?? r.cd_amt),
      bk_code: normCode(r.BK_CODE ?? r.bk_code),
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
    }));
  }

  async function lookupMasterName(comp_code, code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const c = normCode(code);
    if (!cc || !c) return '';
    const rows = await runQuery(
      `SELECT NAME FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = TRIM(:code)`,
      { comp_code: cc, code: c },
      comp_uid
    );
    return String(rows?.[0]?.NAME ?? rows?.[0]?.name ?? '').trim();
  }

  async function loadVoucher(comp_code, comp_uid, vr_type, vr_date, vr_no, opts = {}) {
    const lightweight = opts.lightweight !== false;
    const cc = Number(comp_code) || 0;
    const vt = normCode(vr_type);
    const vdt = parseDateOnly(vr_date);
    const vn = Number(vr_no) || 0;
    if (!vdt || !vn) {
      const err = new Error('vr_date and vr_no are required.');
      err.status = 400;
      throw err;
    }

    const binds = {
      comp_code: cc,
      vr_type: vt,
      vr_date_str: formatDateOut(vdt),
      vr_no: vn,
    };

    const hasIndYn = await voucherSupportsIndYn(comp_uid);
    const rows = await runQuery(voucherLoadSql('VOUCHER', hasIndYn), binds, comp_uid);
    if (!rows?.length) {
      const err = new Error('Voucher not found in VOUCHER table.');
      err.status = 404;
      throw err;
    }

    const lines = mapVoucherLoadRows(rows);

    const cb_code = vt === 'JV' ? '' : normCode(rows[0].DC_CODE ?? rows[0].dc_code);
    const cb_name = cb_code ? await lookupMasterName(cc, cb_code, comp_uid) : '';

    if (lightweight) {
      return {
        ok: true,
        header: {
          vr_type: vt,
          vr_date: formatDateOut(rows[0].VR_DATE ?? rows[0].vr_date ?? vdt),
          vr_no: vn,
          type: normType(rows[0].TYPE ?? rows[0].type),
          r_c_no: Number(rows[0].R_C_NO ?? rows[0].r_c_no ?? 0) || 0,
          cb_code,
          cb_name,
          ac_bal: 0,
          tot_cash: 0,
          jv_vr_no: 0,
          jv_vr_no_int: 0,
        },
        lines,
      };
    }

    const ctx = await fetchCashContext(cc, comp_uid, vdt, cb_code, vt);
    const jvLinks = await resolveLinkedJvDisplay(cc, comp_uid, vt, vdt, vn, { skipDetailMatch: true });

    return {
      ok: true,
      header: {
        vr_type: vt,
        vr_date: formatDateOut(rows[0].VR_DATE ?? rows[0].vr_date ?? vdt),
        vr_no: vn,
        type: normType(rows[0].TYPE ?? rows[0].type),
        r_c_no: Number(rows[0].R_C_NO ?? rows[0].r_c_no ?? 0) || 0,
        cb_code,
        cb_name,
        ac_bal: ctx.ac_bal,
        tot_cash: ctx.tot_cash,
        jv_vr_no: jvLinks.jv_vr_no,
        jv_vr_no_int: jvLinks.jv_vr_no_int,
      },
      lines,
    };
  }

  async function fetchMasterPartyBrief(comp_code, comp_uid, code) {
    const cc = Number(comp_code) || 0;
    const c = normCode(code);
    if (!c) return null;
    const sql = `
      SELECT CODE, NAME, CITY, PAN, GST_NO, TEL_NO_O
      FROM MASTER
      WHERE COMP_CODE = :comp_code AND CODE = :code`;
    const rows = await runQuery(sql, { comp_code: cc, code: c }, comp_uid);
    if (!rows?.[0]) return { code: c, name: '', city: '', pan: '', tel: '' };
    const r = rows[0];
    return {
      code: normCode(r.CODE ?? r.code),
      name: String(r.NAME ?? r.name ?? '').trim(),
      city: String(r.CITY ?? r.city ?? '').trim(),
      pan: String(r.PAN ?? r.pan ?? '').trim(),
      gst: String(r.GST_NO ?? r.gst_no ?? '').trim(),
      tel: String(r.TEL_NO_O ?? r.tel_no_o ?? '').trim(),
    };
  }

  /** Print payload — voucher slip or cash/bank receipt (type R). */
  async function fetchVoucherPrint(comp_code, comp_uid, vr_type, vr_date, vr_no) {
    const data = await loadVoucher(comp_code, comp_uid, vr_type, vr_date, vr_no, { lightweight: false });
    const h = data.header || {};
    const vt = normCode(vr_type);
    const mtype = normType(h.type);
    const isReceipt = mtype === 'R' && (vt === 'CV' || vt === 'BV');
    const cbCode = normCode(h.cb_code);

    let gridLines = Array.isArray(data.lines) ? [...data.lines] : [];
    if (cbCode && vt !== 'JV') {
      gridLines = gridLines.filter((ln) => normCode(ln.code) !== cbCode);
    }

    const voucherLines = gridLines.map((ln) => {
      const dr = num(ln.dr_amt);
      const cr = num(ln.cr_amt);
      const code = normCode(ln.code);
      const name = String(ln.name ?? '').trim();
      const detail = String(ln.detail ?? '').trim();
      return {
        code,
        name,
        detail,
        particulars: formatVoucherPrintParticulars(code, name, detail),
        dr_amt: dr,
        cr_amt: cr,
        dc_code: normCode(ln.dc_code),
      };
    });

    let totalDr = 0;
    let totalCr = 0;
    for (const ln of voucherLines) {
      totalDr += ln.dr_amt;
      totalCr += ln.cr_amt;
    }

    let receiptLines = [];
    let party = null;
    if (isReceipt && gridLines.length) {
      const partyLine =
        gridLines.find((ln) => num(ln.cr_amt) > 0) ||
        gridLines.find((ln) => num(ln.dr_amt) > 0) ||
        gridLines[0];
      if (partyLine?.code) {
        party = await fetchMasterPartyBrief(comp_code, comp_uid, partyLine.code);
      }
      receiptLines = gridLines
        .filter((ln) => num(ln.dr_amt) !== 0 || num(ln.cr_amt) !== 0)
        .map((ln) => {
          const cash = Math.max(num(ln.dr_amt), num(ln.cr_amt));
          const intAmt = num(ln.int_amt);
          const cdAmt = num(ln.cd_amt);
          const billAmt = Math.max(0, cash - intAmt);
          return {
            bill_date: formatDateOut(ln.bill_date || h.vr_date),
            bill_no: Number(ln.bill_no ?? 0) || 0,
            bill_amt: billAmt,
            int_amt: intAmt,
            cd_amt: cdAmt,
            total: cash,
            cash_received: cash,
          };
        });
    }

    const docTitles = {
      CV: isReceipt ? 'CASH RECEIPT' : 'CASH VOUCHER',
      BV: isReceipt ? 'BANK RECEIPT' : 'BANK VOUCHER',
      JV: 'JOURNAL VOUCHER',
    };

    return {
      ok: true,
      format: isReceipt ? 'receipt' : 'voucher',
      vr_type: vt,
      document_title: docTitles[vt] || `${vt} VOUCHER`,
      header: {
        ...h,
        receipt_no: mtype === 'R' ? Number(h.r_c_no ?? 0) || Number(h.vr_no ?? 0) : Number(h.vr_no ?? 0),
        document_no: Number(h.vr_no ?? 0),
      },
      voucher_lines: voucherLines,
      receipt_lines: receiptLines,
      party,
      totals: { dr: totalDr, cr: totalCr, amount: Math.max(totalDr, totalCr) },
    };
  }

  async function deleteVoucherBundle(comp_code, comp_uid, vr_type, vr_date, vr_no, voucherType, q) {
    const cc = Number(comp_code) || 0;
    const vt = normCode(vr_type);
    const vdt = parseDateOnly(vr_date);
    const vn = Number(vr_no) || 0;
    if (!vdt || !vn) {
      const err = new Error('vr_date and vr_no are required.');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, vr_type: vt, vr_date: vdt, vr_no: vn };
    const where = `COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_DATE = :vr_date AND VR_NO = :vr_no`;
    const query = q || makeQuery(comp_uid);

    const tryDelete = async (table, extraWhere = '') => {
      try {
        await query(`DELETE FROM ${table} WHERE ${where}${extraWhere}`, binds);
      } catch (err) {
        if (!/table or view does not exist|invalid identifier/i.test(String(err?.message || ''))) {
          throw err;
        }
      }
    };

    await tryDelete('BILLS');
    await tryDelete('BANKSTMT');
    await tryDelete('TDS');
    if (normType(voucherType) === 'R') {
      try {
        await query(`DELETE FROM HI_RECEIPT WHERE COMP_CODE = :comp_code AND VR_NO = :vr_no`, {
          comp_code: cc,
          vr_no: vn,
        });
      } catch (err) {
        if (!/table or view does not exist|invalid identifier/i.test(String(err?.message || ''))) {
          throw err;
        }
      }
    }
    await query(`DELETE FROM LEDGER WHERE ${where}`, binds);
    await query(`DELETE FROM VOUCHER WHERE ${where}`, binds);
  }

  /** JV_VR_NO / JV_VR_NO_INT on source voucher (any TYPE on same Vr.No). */
  async function fetchJvLinkNumbers(comp_code, comp_uid, vr_type, vdt, vr_no) {
    const cc = Number(comp_code) || 0;
    const binds = {
      comp_code: cc,
      vr_type: normCode(vr_type),
      vr_date: vdt,
      vr_no: Number(vr_no) || 0,
    };
    const linkSql = `SELECT MAX(NVL(JV_VR_NO, 0)) AS JV_VR_NO, MAX(NVL(JV_VR_NO_INT, 0)) AS JV_VR_NO_INT
         FROM {TABLE}
         WHERE COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_DATE = :vr_date AND VR_NO = :vr_no`;
    const readLinks = (rows) => ({
      jv_vr_no: num(rows?.[0]?.JV_VR_NO ?? rows?.[0]?.jv_vr_no),
      jv_vr_no_int: num(rows?.[0]?.JV_VR_NO_INT ?? rows?.[0]?.jv_vr_no_int),
    });
    try {
      const rows = await runQuery(linkSql.replace('{TABLE}', 'VOUCHER'), binds, comp_uid);
      const fromVoucher = readLinks(rows);
      if (fromVoucher.jv_vr_no || fromVoucher.jv_vr_no_int) return fromVoucher;
    } catch (_) {
      /* fall through */
    }
    try {
      const rows = await runQuery(linkSql.replace('{TABLE}', 'LEDGER'), binds, comp_uid);
      return readLinks(rows);
    } catch (_) {
      return { jv_vr_no: 0, jv_vr_no_int: 0 };
    }
  }

  /** JV rows created by CDTRF/INTTRF reference back to source CV/BV/BI. */
  async function findJvNosByTrfRef(comp_code, comp_uid, trfVrType, trfVrDate, trfVrNo, trfType) {
    const cc = Number(comp_code) || 0;
    const vdt = parseDateOnly(trfVrDate);
    if (!vdt || !trfVrNo) return [];
    const binds = {
      comp_code: cc,
      trf_vr_type: normCode(trfVrType),
      trf_vr_date: vdt,
      trf_vr_no: Number(trfVrNo) || 0,
      trf_type: normType(trfType),
    };
    const sqlWithType = `
      SELECT DISTINCT VR_NO, VR_DATE
      FROM VOUCHER
      WHERE COMP_CODE = :comp_code
        AND VR_TYPE = 'JV'
        AND TRF_VR_TYPE = :trf_vr_type
        AND TRF_VR_DATE = :trf_vr_date
        AND TRF_VR_NO = :trf_vr_no
        AND NVL(TYPE, 'N') = :trf_type`;
    const sqlNoType = `
      SELECT DISTINCT VR_NO, VR_DATE
      FROM VOUCHER
      WHERE COMP_CODE = :comp_code
        AND VR_TYPE = 'JV'
        AND TRF_VR_TYPE = :trf_vr_type
        AND TRF_VR_DATE = :trf_vr_date
        AND TRF_VR_NO = :trf_vr_no`;
    for (const sql of [sqlWithType, sqlNoType]) {
      try {
        const rows = await runQuery(sql, binds, comp_uid);
        return (rows || [])
          .map((r) => ({
            vr_no: num(r.VR_NO ?? r.vr_no),
            vr_date: parseDateOnly(r.VR_DATE ?? r.vr_date) || vdt,
          }))
          .filter((r) => r.vr_no > 0);
      } catch (err) {
        if (!/invalid identifier|ORA-00904/i.test(String(err?.message || ''))) throw err;
      }
    }
    return [];
  }

  /** Single JV Vr.No by detail pattern + party on source voucher (CD.% / Interest%). */
  async function findJvNoByDetailMatch(comp_code, comp_uid, srcVrType, vdt, vr_no, detailLike) {
    const cc = Number(comp_code) || 0;
    const binds = {
      comp_code: cc,
      src_vr_type: normCode(srcVrType),
      vr_date: vdt,
      vr_no: Number(vr_no) || 0,
      detail_like: String(detailLike || '').trim(),
    };
    if (!binds.detail_like) return 0;
    const sql = `
      SELECT MAX(j.VR_NO) AS VR_NO
      FROM VOUCHER j
      WHERE j.COMP_CODE = :comp_code
        AND j.VR_TYPE = 'JV'
        AND j.VR_DATE = :vr_date
        AND j.DETAIL LIKE :detail_like
        AND (
          EXISTS (
            SELECT 1 FROM VOUCHER c
            WHERE c.COMP_CODE = j.COMP_CODE
              AND c.VR_TYPE = :src_vr_type
              AND c.VR_DATE = :vr_date
              AND c.VR_NO = :vr_no
              AND TRIM(c.CODE) = TRIM(j.CODE)
          )
          OR EXISTS (
            SELECT 1 FROM LEDGER c
            WHERE c.COMP_CODE = j.COMP_CODE
              AND c.VR_TYPE = :src_vr_type
              AND c.VR_DATE = :vr_date
              AND c.VR_NO = :vr_no
              AND TRIM(c.DC_CODE) = TRIM(j.CODE)
          )
        )`;
    try {
      const rows = await runQuery(sql, binds, comp_uid);
      return num(rows?.[0]?.VR_NO ?? rows?.[0]?.vr_no);
    } catch (_) {
      return 0;
    }
  }

  /** JV_VR_NO / JV_VR_NO_INT for display on cash voucher form. */
  async function resolveLinkedJvDisplay(comp_code, comp_uid, vr_type, vdt, vr_no, opts = {}) {
    const vt = normCode(vr_type);
    const links = await fetchJvLinkNumbers(comp_code, comp_uid, vt, vdt, vr_no);
    let jv_vr_no = links.jv_vr_no;
    let jv_vr_no_int = links.jv_vr_no_int;
    if (!opts.skipDetailMatch) {
      if (!jv_vr_no) {
        jv_vr_no = await findJvNoByDetailMatch(comp_code, comp_uid, vt, vdt, vr_no, 'CD.%');
      }
      if (!jv_vr_no_int) {
        jv_vr_no_int = await findJvNoByDetailMatch(comp_code, comp_uid, vt, vdt, vr_no, 'Interest%');
      }
    }
    return { jv_vr_no, jv_vr_no_int };
  }

  /** Fallback when JV_VR_NO link column is empty — match CD./Interest JV lines for same party. */
  async function findJvNosByPartyDetailMatch(comp_code, comp_uid, srcVrType, vdt, vr_no) {
    const cc = Number(comp_code) || 0;
    const binds = {
      comp_code: cc,
      src_vr_type: normCode(srcVrType),
      vr_date: vdt,
      vr_no: Number(vr_no) || 0,
    };
    const sql = `
      SELECT DISTINCT j.VR_NO AS VR_NO, j.VR_DATE AS VR_DATE
      FROM VOUCHER j
      WHERE j.COMP_CODE = :comp_code
        AND j.VR_TYPE = 'JV'
        AND j.VR_DATE = :vr_date
        AND (
          j.DETAIL LIKE 'CD.%'
          OR j.DETAIL LIKE 'Interest%'
        )
        AND (
          EXISTS (
            SELECT 1 FROM VOUCHER c
            WHERE c.COMP_CODE = j.COMP_CODE
              AND c.VR_TYPE = :src_vr_type
              AND c.VR_DATE = :vr_date
              AND c.VR_NO = :vr_no
              AND TRIM(c.CODE) = TRIM(j.CODE)
          )
          OR EXISTS (
            SELECT 1 FROM LEDGER c
            WHERE c.COMP_CODE = j.COMP_CODE
              AND c.VR_TYPE = :src_vr_type
              AND c.VR_DATE = :vr_date
              AND c.VR_NO = :vr_no
              AND TRIM(c.DC_CODE) = TRIM(j.CODE)
          )
        )`;
    try {
      const rows = await runQuery(sql, binds, comp_uid);
      return (rows || [])
        .map((r) => ({
          vr_no: num(r.VR_NO ?? r.vr_no),
          vr_date: parseDateOnly(r.VR_DATE ?? r.vr_date) || vdt,
        }))
        .filter((r) => r.vr_no > 0);
    } catch (_) {
      return [];
    }
  }

  async function collectLinkedJvTargets(comp_code, comp_uid, srcVrType, vdt, vr_no, mtype) {
    const vt = normCode(srcVrType);
    if (!['CV', 'BV', 'BI'].includes(vt)) return [];

    const targets = new Map();
    const add = (jvNo, jvDate) => {
      const n = Number(jvNo) || 0;
      if (n <= 0) return;
      const d = jvDate instanceof Date && !Number.isNaN(jvDate.getTime()) ? jvDate : parseDateOnly(jvDate) || vdt;
      const key = `${n}|${d.getTime()}`;
      if (!targets.has(key)) targets.set(key, { vr_no: n, vr_date: d });
    };

    const links = await fetchJvLinkNumbers(comp_code, comp_uid, vt, vdt, vr_no);
    add(links.jv_vr_no, vdt);
    add(links.jv_vr_no_int, vdt);

    if (!targets.size) {
      const trfHits = await findJvNosByTrfRef(comp_code, comp_uid, vt, vdt, vr_no, mtype);
      for (const hit of trfHits) add(hit.vr_no, hit.vr_date);
    }

    if (!targets.size) {
      const detailHits = await findJvNosByPartyDetailMatch(comp_code, comp_uid, vt, vdt, vr_no);
      for (const hit of detailHits) add(hit.vr_no, hit.vr_date);
    }

    return [...targets.values()];
  }

  /** Delete CV/BV/BI and linked CD/interest JV vouchers (VFP CDTRF / INTTRF). */
  async function deleteVoucherEntry(comp_code, comp_uid, vr_type, vr_date, vr_no, voucherType) {
    const vdt = parseDateOnly(vr_date);
    const vn = Number(vr_no) || 0;
    if (!vdt || !vn) {
      const err = new Error('vr_date and vr_no are required.');
      err.status = 400;
      throw err;
    }
    const mtype = normType(voucherType);
    const jvTargets = await collectLinkedJvTargets(comp_code, comp_uid, vr_type, vdt, vn, mtype);
    return runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await deleteVoucherBundle(comp_code, comp_uid, vr_type, vr_date, vr_no, voucherType, q);
      for (const jv of jvTargets) {
        await deleteVoucherBundle(comp_code, comp_uid, 'JV', jv.vr_date, jv.vr_no, 'N', q);
      }
      return { jv_deleted: jvTargets.map((j) => j.vr_no) };
    });
  }

  async function insertVoucherLine(comp_uid, binds, q, hasIndYnFlag) {
    const hasIndYn =
      typeof hasIndYnFlag === 'boolean' ? hasIndYnFlag : await voucherSupportsIndYn(comp_uid);
    const indYnCol = hasIndYn ? ', IND_YN' : '';
    const indYnVal = hasIndYn ? ', :ind_yn' : '';
    const voucherSql = `
      INSERT INTO VOUCHER (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, TRN_NO, CODE,
        DR_AMT, CR_AMT, DC_CODE, CHQ_NO, DETAIL${indYnCol}, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME,
        BILL_DATE, BILL_NO, B_TYPE, INT_AMT, V_DATE, LOT, BK_CODE, CD_AMT, R_C_NO, B_NO, COST_CODE
      ) VALUES (
        :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :trn_no, :code,
        :dr_amt, :cr_amt, :dc_code, :chq_no, :detail${indYnVal}, :user_name, :ent_date, :ent_time, :computer_name,
        :bill_date, :bill_no, :b_type, :int_amt, :v_date, :lot, :bk_code, :cd_amt, :r_c_no, :b_no, :cost_code
      )`;
    const ledgerSql = `
      INSERT INTO LEDGER (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, TRN_NO, CODE,
        DR_AMT, CR_AMT, DC_CODE, CHQ_NO, DETAIL, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME,
        BILL_DATE, BILL_NO, V_DATE, LOT, BK_CODE, COST_CODE
      ) VALUES (
        :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :trn_no, :code,
        :dr_amt, :cr_amt, :dc_code, :chq_no, :detail, :user_name, :ent_date, :ent_time, :computer_name,
        :bill_date, :bill_no, :v_date, :lot, :bk_code, :cost_code
      )`;
    const ledgerBinds = {
      comp_code: binds.comp_code,
      comp_year: binds.comp_year,
      vr_type: binds.vr_type,
      vr_date: binds.vr_date,
      vr_no: binds.vr_no,
      type: binds.type,
      trn_no: binds.trn_no,
      code: binds.code,
      dr_amt: binds.dr_amt,
      cr_amt: binds.cr_amt,
      dc_code: binds.dc_code,
      chq_no: binds.chq_no,
      detail: binds.detail,
      user_name: binds.user_name,
      ent_date: binds.ent_date,
      ent_time: binds.ent_time,
      computer_name: binds.computer_name,
      bill_date: binds.bill_date,
      bill_no: binds.bill_no,
      v_date: binds.v_date,
      lot: binds.lot,
      bk_code: binds.bk_code,
      cost_code: binds.cost_code,
    };
    const voucherBinds = hasIndYn
      ? { ...binds, ind_yn: String(binds.ind_yn ?? ' ').trim().slice(0, 1) || ' ' }
      : binds;
    const query = q || makeQuery(comp_uid);
    await query(voucherSql, voucherBinds);
    await query(ledgerSql, ledgerBinds);
  }

  async function insertLedgerMirror(comp_uid, binds, q) {
    const ledgerSql = `
      INSERT INTO LEDGER (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, CHQ_NO, DETAIL,
        DC_CODE, TRN_NO, V_DATE, USER_NAME, ENT_DATE, ENT_TIME, COMPUTER_NAME
      ) VALUES (
        :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code, :dr_amt, :cr_amt, :chq_no, :detail,
        :dc_code, :trn_no, :v_date, :user_name, :ent_date, :ent_time, :computer_name
      )`;
    const query = q || makeQuery(comp_uid);
    await query(ledgerSql, binds);
  }

  async function insertBillLine(comp_uid, binds, q) {
    const sql = `
      INSERT INTO BILLS (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE,
        DR_AMT, CR_AMT, DETAIL, BILL_DATE, BILL_NO, V_DATE, B_TYPE, BK_CODE
      ) VALUES (
        :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code,
        :dr_amt, :cr_amt, :detail, :bill_date, :bill_no, :v_date, :b_type, :bk_code
      )`;
    const query = q || makeQuery(comp_uid);
    try {
      await query(sql, binds);
    } catch (err) {
      if (!/table or view does not exist/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }

  async function insertHiReceipt(comp_uid, binds, q) {
    const sql = `
      INSERT INTO HI_RECEIPT (COMP_CODE, COMP_YEAR, VR_DATE, VR_NO, USER_NAME, CODE, CR_AMT)
      VALUES (:comp_code, :comp_year, :vr_date, :vr_no, :user_name, :code, :cr_amt)`;
    const query = q || makeQuery(comp_uid);
    try {
      await query(sql, binds);
    } catch (err) {
      if (!/table or view does not exist|invalid identifier/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }

  async function fetchExistingJvLinks(comp_code, comp_uid, vr_type, vdt, vr_no, mtype) {
    const cc = Number(comp_code) || 0;
    const binds = {
      comp_code: cc,
      vr_type: normCode(vr_type),
      vr_date: vdt,
      vr_no: Number(vr_no) || 0,
      type: normType(mtype),
    };
    try {
      const rows = await runQuery(
        `SELECT MAX(NVL(JV_VR_NO, 0)) AS JV_VR_NO, MAX(NVL(JV_VR_NO_INT, 0)) AS JV_VR_NO_INT
         FROM VOUCHER
         WHERE COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_DATE = :vr_date
           AND VR_NO = :vr_no AND TYPE = :type`,
        binds,
        comp_uid
      );
      return {
        jv_vr_no: num(rows?.[0]?.JV_VR_NO ?? rows?.[0]?.jv_vr_no),
        jv_vr_no_int: num(rows?.[0]?.JV_VR_NO_INT ?? rows?.[0]?.jv_vr_no_int),
      };
    } catch (_) {
      return { jv_vr_no: 0, jv_vr_no_int: 0 };
    }
  }

  async function updateJvLinkField(comp_uid, table, field, value, whereBinds, q) {
    const query = q || makeQuery(comp_uid);
    try {
      await query(
        `UPDATE ${table} SET ${field} = :jv_no
         WHERE COMP_CODE = :comp_code AND VR_TYPE = :vr_type AND VR_DATE = :vr_date
           AND VR_NO = :vr_no AND TYPE = :type`,
        { ...whereBinds, jv_no: Number(value) || 0 }
      );
      return true;
    } catch (err) {
      if (/invalid identifier|table or view does not exist/i.test(String(err?.message || ''))) return false;
      throw err;
    }
  }

  async function insertTrfBillLine(comp_uid, binds, q) {
    const query = q || makeQuery(comp_uid);
    const baseSql = `
      INSERT INTO BILLS (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE,
        DR_AMT, CR_AMT, DETAIL, BILL_DATE, BILL_NO, V_DATE, B_TYPE, BK_CODE
      ) VALUES (
        :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code,
        :dr_amt, :cr_amt, :detail, :bill_date, :bill_no, :v_date, :b_type, :bk_code
      )`;
    const cdSql = `
      INSERT INTO BILLS (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE,
        DR_AMT, CR_AMT, DETAIL, BILL_DATE, BILL_NO, V_DATE, B_TYPE, BK_CODE, CD_AMT
      ) VALUES (
        :comp_code, :comp_year, :vr_type, :vr_date, :vr_no, :type, :code,
        :dr_amt, :cr_amt, :detail, :bill_date, :bill_no, :v_date, :b_type, :bk_code, :cd_amt
      )`;
    try {
      if (num(binds.cd_amt) > 0) {
        try {
          await query(cdSql, binds);
          return;
        } catch (err) {
          if (!/invalid identifier|ORA-00904/i.test(String(err?.message || ''))) throw err;
        }
      }
      await query(baseSql, binds);
    } catch (err) {
      if (!/table or view does not exist/i.test(String(err?.message || ''))) {
        throw err;
      }
    }
  }

  function resolveCdCode(globals) {
    return normCode(globals?.cd_code) || 'E00000';
  }

  function jvTransferBase(cc, cy, jvNo, vdt, userName, entDate, entTime, compName) {
    return {
      comp_code: cc,
      comp_year: cy,
      vr_type: 'JV',
      vr_date: vdt,
      vr_no: jvNo,
      type: 'N',
      user_name: userName,
      ent_date: entDate,
      ent_time: entTime,
      computer_name: compName,
      chq_no: '',
      lot: '',
      int_amt: 0,
      r_c_no: 0,
      b_no: 0,
      cost_code: '',
    };
  }

  function cdDetailText(billDate, billNo) {
    const dt = billDate ? formatDateOut(billDate) : '';
    const no = String(Number(billNo) || 0).padStart(6, ' ');
    return `CD.${dt} ${no}`.trim();
  }

  /** VFP voucher.scx CDTRF / INTTRF — post linked JV lines after CV/BV/BI save. */
  async function runVoucherCdTransfer(
    comp_code,
    comp_year,
    comp_uid,
    globals,
    { vr_type, vdt, vr_no, mtype, partyMeta, userName, entDate, entTime, compName, reuseJvNo },
    q,
    hasIndYnFlag
  ) {
    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    const vt = normCode(vr_type);
    if (!['CV', 'BV', 'BI'].includes(vt)) return 0;
    const cdCode = resolveCdCode(globals);
    const cdLines = partyMeta.filter((ln) => num(ln.cd_amt) > 0);
    if (!cdLines.length) return 0;
    await assertMasterCode(cc, cdCode, comp_uid, 'CD account (CD_CODE)');

    let jvNo = Number(reuseJvNo) || 0;
    if (!jvNo) jvNo = await fetchNextVrNo(cc, comp_uid, 'JV', vdt);
    let trnNo = 901;
    const jvBase = jvTransferBase(cc, cy, jvNo, vdt, userName, entDate, entTime, compName);

    for (const ln of cdLines) {
      const cdAmt = num(ln.cd_amt);
      const billDate = ln.bill_date || null;
      const billNo = Number(ln.bill_no) || 0;
      const bType = String(ln.b_type ?? ' ').trim() || ' ';
      const detail = cdDetailText(billDate, billNo);
      const vDate = ln.v_date || vdt;

      await insertVoucherLine(comp_uid, {
        ...jvBase,
        trn_no: trnNo,
        code: ln.code,
        dr_amt: 0,
        cr_amt: cdAmt,
        detail,
        dc_code: cdCode,
        bill_date: billDate,
        bill_no: billNo,
        b_type: bType,
        v_date: vDate,
        bk_code: ln.bk_code || '',
        cd_amt: cdAmt,
      }, q, hasIndYnFlag);
      trnNo += 1;

      await insertTrfBillLine(comp_uid, {
        comp_code: cc,
        comp_year: cy,
        vr_type: 'JV',
        vr_date: vdt,
        vr_no: jvNo,
        type: 'N',
        code: ln.code,
        dr_amt: 0,
        cr_amt: cdAmt,
        detail,
        bill_date: billDate,
        bill_no: billNo,
        v_date: vDate,
        b_type: bType,
        bk_code: ln.bk_code || '',
        cd_amt: cdAmt,
      }, q);

      await insertVoucherLine(comp_uid, {
        ...jvBase,
        trn_no: trnNo,
        code: cdCode,
        dr_amt: cdAmt,
        cr_amt: 0,
        detail: `${detail} ${ln.name || ''}`.trim(),
        dc_code: ln.code,
        bill_date: null,
        bill_no: 0,
        b_type: ' ',
        v_date: vDate,
        bk_code: ln.bk_code || '',
        cd_amt: cdAmt,
      }, q, hasIndYnFlag);
      trnNo += 1;
    }

    const linkBinds = {
      comp_code: cc,
      vr_type: vt,
      vr_date: vdt,
      vr_no,
      type: mtype,
    };
    await updateJvLinkField(comp_uid, 'VOUCHER', 'JV_VR_NO', jvNo, linkBinds, q);
    return jvNo;
  }

  async function runVoucherIntTransfer(
    comp_code,
    comp_year,
    comp_uid,
    globals,
    { vr_type, vdt, vr_no, mtype, partyMeta, userName, entDate, entTime, compName, reuseJvNo },
    q,
    hasIndYnFlag
  ) {
    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    const vt = normCode(vr_type);
    if (String(globals?.auto_int_trf ?? 'N').toUpperCase() !== 'Y') return 0;
    if (!['CV', 'BV', 'BI'].includes(vt)) return 0;
    const intCode = normCode(globals?.int_trf_code);
    if (!intCode) return 0;
    const intLines = partyMeta.filter((ln) => num(ln.int_amt) > 0);
    if (!intLines.length) return 0;
    await assertMasterCode(cc, intCode, comp_uid, 'Interest transfer account (INT_TRF_CODE)');

    let jvNo = Number(reuseJvNo) || 0;
    if (!jvNo) jvNo = await fetchNextVrNo(cc, comp_uid, 'JV', vdt);
    let trnNo = 801;
    const jvBase = jvTransferBase(cc, cy, jvNo, vdt, userName, entDate, entTime, compName);

    for (const ln of intLines) {
      const intAmt = num(ln.int_amt);
      const isCrParty = num(ln.cr_amt) > 0;
      const billDate = ln.bill_date || null;
      const billNo = Number(ln.bill_no) || 0;
      const bType = String(ln.b_type ?? ' ').trim() || ' ';
      const vDate = ln.v_date || vdt;

      await insertVoucherLine(comp_uid, {
        ...jvBase,
        trn_no: trnNo,
        code: ln.code,
        dr_amt: isCrParty ? intAmt : 0,
        cr_amt: isCrParty ? 0 : intAmt,
        detail: 'Interest',
        dc_code: intCode,
        bill_date: billDate,
        bill_no: billNo,
        b_type: bType,
        v_date: vDate,
        bk_code: ln.bk_code || '',
        cd_amt: 0,
      }, q, hasIndYnFlag);
      trnNo += 1;

      await insertTrfBillLine(comp_uid, {
        comp_code: cc,
        comp_year: cy,
        vr_type: 'JV',
        vr_date: vdt,
        vr_no: jvNo,
        type: 'N',
        code: ln.code,
        dr_amt: isCrParty ? intAmt : 0,
        cr_amt: isCrParty ? 0 : intAmt,
        detail: 'Interest',
        bill_date: billDate,
        bill_no: billNo,
        v_date: vDate,
        b_type: bType,
        bk_code: ln.bk_code || '',
        cd_amt: 0,
      }, q);

      const billTag = billDate
        ? ` ${formatDateOut(billDate)} ${String(billNo).padStart(6, ' ')}`
        : '';
      await insertVoucherLine(comp_uid, {
        ...jvBase,
        trn_no: trnNo,
        code: intCode,
        dr_amt: isCrParty ? 0 : intAmt,
        cr_amt: isCrParty ? intAmt : 0,
        detail: `Interest ${ln.name || ''}${billTag}`.trim(),
        dc_code: ln.code,
        bill_date: null,
        bill_no: 0,
        b_type: ' ',
        v_date: vDate,
        bk_code: ln.bk_code || '',
        cd_amt: 0,
      }, q, hasIndYnFlag);
      trnNo += 1;
    }

    const linkBinds = {
      comp_code: cc,
      vr_type: vt,
      vr_date: vdt,
      vr_no,
      type: mtype,
    };
    await updateJvLinkField(comp_uid, 'VOUCHER', 'JV_VR_NO_INT', jvNo, linkBinds, q);
    await updateJvLinkField(comp_uid, 'LEDGER', 'JV_VR_NO_INT', jvNo, linkBinds, q);
    await updateJvLinkField(comp_uid, 'BILLS', 'JV_VR_NO_INT', jvNo, linkBinds, q);
    return jvNo;
  }

  function normalizeLine(ln, idx, vdt) {
    const billDate = lineDate(ln.bill_date ?? ln.BILL_DATE, null);
    const valDate = lineDate(ln.v_date ?? ln.V_DATE, vdt);
    return {
      trn_no: Number(ln.trn_no ?? ln.TRN_NO ?? idx + 1) || idx + 1,
      code: normCode(ln.code ?? ln.CODE),
      dr_amt: num(ln.dr_amt ?? ln.DR_AMT),
      cr_amt: num(ln.cr_amt ?? ln.CR_AMT),
      detail: String(ln.detail ?? ln.DETAIL ?? '').trim(),
      v_date: valDate,
      lot: String(ln.lot ?? ln.LOT ?? '').trim(),
      chq_no: String(ln.chq_no ?? ln.CHQ_NO ?? '').trim().slice(0, 6),
      bill_date: billDate,
      bill_no: Number(ln.bill_no ?? ln.BILL_NO ?? 0) || 0,
      b_type: String(ln.b_type ?? ln.B_TYPE ?? ' ').trim() || ' ',
      int_amt: num(ln.int_amt ?? ln.INT_AMT),
      cd_amt: num(ln.cd_amt ?? ln.CD_AMT),
      bk_code: normCode(ln.bk_code ?? ln.BK_CODE),
      cost_code: normCode(ln.cost_code ?? ln.COST_CODE),
      b_no: Number(ln.b_no ?? ln.B_NO ?? 0) || 0,
      ind_yn: normalizeBillHelpIndYn(ln.ind_yn ?? ln.IND_YN).slice(0, 1) || ' ',
      dc_code: normCode(ln.dc_code ?? ln.DC_CODE),
    };
  }

  async function saveCashVoucher(comp_code, comp_year, comp_uid, body, req) {
    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    const vr_type = normCode(body.vr_type ?? 'CV') || 'CV';
    const vdt = parseDateOnly(body.vr_date);
    if (!vdt) {
      const err = new Error('Voucher date is required.');
      err.status = 400;
      throw err;
    }

    const fyStart = parseDateOnly(body.fy_s_date ?? body.FY_S_DATE ?? body.comp_s_dt ?? body.COMP_S_DT);
    const fyEnd = parseDateOnly(body.fy_e_date ?? body.FY_E_DATE ?? body.comp_e_dt ?? body.COMP_E_DT);
    assertDateInFinYear(vdt, fyStart, fyEnd, 'Voucher date');

    const mode = String(body.mode ?? 'new').trim().toLowerCase();
    const mtype = normType(body.type ?? body.TYPE ?? 'N');
    const r_c_no = Number(body.r_c_no ?? body.R_C_NO ?? 0) || 0;
    const masterCache = new Map();
    async function cachedMaster(code, label) {
      const c = normCode(code);
      const key = `${cc}|${c}`;
      if (masterCache.has(key)) return masterCache.get(key);
      const meta = await assertMasterCode(cc, c, comp_uid, label);
      masterCache.set(key, meta);
      return meta;
    }

    const isJournal = vr_type === 'JV';
    const isCashBank = !isJournal;
    const cbLabel = vr_type === 'BV' ? 'Bank account' : 'Cash account';

    let cb = { code: '', name: '' };
    if (isCashBank) {
      cb = await cachedMaster(body.cb_code ?? body.CBCODE, cbLabel);
      if (!cb.code) {
        const err = new Error(`Select ${vr_type === 'BV' ? 'bank' : 'cash'} account.`);
        err.status = 400;
        throw err;
      }
    }

    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn
      .map((ln, idx) => normalizeLine(ln, idx, vdt))
      .filter((ln) => ln.code && (ln.dr_amt !== 0 || ln.cr_amt !== 0));

    if (!lines.length) {
      const err = new Error('Enter at least one voucher line.');
      err.status = 400;
      throw err;
    }

    let totalDr = 0;
    let totalCr = 0;
    const partyMeta = [];
    for (const ln of lines) {
      if (isCashBank && ln.code === cb.code) {
        const err = new Error(`Party code cannot be the same as ${vr_type === 'BV' ? 'bank' : 'cash'} account.`);
        err.status = 400;
        throw err;
      }
      if (ln.dr_amt !== 0 && ln.cr_amt !== 0) {
        const err = new Error('Each line must be debit OR credit, not both.');
        err.status = 400;
        throw err;
      }
      totalDr += ln.dr_amt;
      totalCr += ln.cr_amt;
      const meta = await cachedMaster(ln.code, 'Party');
      partyMeta.push({ ...ln, name: meta.name });
    }

    const voucherAmt = Math.max(totalDr, totalCr);
    if (isJournal) {
      if (Math.abs(totalDr - totalCr) > 0.009) {
        const err = new Error(`Debit (${totalDr}) and credit (${totalCr}) must balance.`);
        err.status = 400;
        throw err;
      }
      if (voucherAmt <= 0) {
        const err = new Error('Voucher amount must be greater than zero.');
        err.status = 400;
        throw err;
      }
    } else {
      // CV/BV: party lines are one-sided; cash/bank mirror posts to LEDGER on save (VFP).
      if (voucherAmt <= 0) {
        const err = new Error('Enter Dr or Cr amount on at least one line.');
        err.status = 400;
        throw err;
      }
      if (totalDr > 0 && totalCr > 0) {
        const err = new Error('Cash/Bank voucher lines must be all debit or all credit on the party side.');
        err.status = 400;
        throw err;
      }
    }

    let vr_no = Number(body.vr_no ?? body.VR_NO ?? 0) || 0;
    let prevJv = { jv_vr_no: 0, jv_vr_no_int: 0 };
    if (mode === 'edit') {
      if (!vr_no) {
        const err = new Error('Voucher number is required for edit.');
        err.status = 400;
        throw err;
      }
      prevJv = await fetchExistingJvLinks(cc, comp_uid, vr_type, vdt, vr_no, mtype);
    } else {
      if (!vr_no) {
        vr_no = await fetchNextVrNo(cc, comp_uid, vr_type, vdt);
      }
    }

    const userName = String(body.user_name ?? body.USER_NAME ?? '').trim();
    const entDate = new Date();
    const entTime = entTimeNow();
    const compName = computerName(req);
    const globals = await fetchBillHelpSettings(cc, comp_uid);
    const hasIndYnCol = await voucherSupportsIndYn(comp_uid);
    if (partyMeta.some((ln) => num(ln.cd_amt) > 0)) {
      await cachedMaster(resolveCdCode(globals), 'CD account (CD_CODE)');
    }

    partyMeta.sort((a, b) => a.trn_no - b.trn_no);
    let receiptParty = '';
    let receiptCr = 0;

    for (const ln of partyMeta) {
      if (ln.v_date) assertDateInFinYear(ln.v_date, fyStart, fyEnd, 'Value date');
    }

    return runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);

      if (mode === 'edit') {
        await deleteVoucherBundle(cc, comp_uid, vr_type, vdt, vr_no, mtype, q);
      }

      for (let i = 0; i < partyMeta.length; i += 1) {
        const ln = partyMeta[i];
        const trnNo = i + 1;
        const detail = ln.detail || ln.name;
        const base = {
          comp_code: cc,
          comp_year: cy,
          vr_type,
          vr_date: vdt,
          vr_no,
          type: mtype,
          user_name: userName,
          ent_date: entDate,
          ent_time: entTime,
          computer_name: compName,
          trn_no: trnNo,
          chq_no: ln.chq_no,
          bill_date: ln.bill_date,
          bill_no: ln.bill_no,
          b_type: ln.b_type,
          int_amt: ln.int_amt,
          v_date: ln.v_date || vdt,
          lot: ln.lot,
          bk_code: ln.bk_code,
          cost_code: ln.cost_code,
          cd_amt: ln.cd_amt,
          r_c_no,
          b_no: ln.b_no,
          ind_yn: ln.ind_yn || ' ',
        };

        await insertVoucherLine(
          comp_uid,
          {
            ...base,
            code: ln.code,
            dr_amt: ln.dr_amt,
            cr_amt: ln.cr_amt,
            detail,
            dc_code: isCashBank ? cb.code : (ln.dc_code || ' '),
          },
          q,
          hasIndYnCol
        );

        if (isCashBank) {
          await insertLedgerMirror(
            comp_uid,
            {
              comp_code: cc,
              comp_year: cy,
              vr_type,
              vr_date: vdt,
              vr_no,
              type: mtype,
              code: cb.code,
              dr_amt: ln.cr_amt,
              cr_amt: ln.dr_amt,
              detail: ln.name,
              dc_code: ln.code,
              chq_no: ln.chq_no,
              trn_no: trnNo,
              v_date: ln.v_date || vdt,
              user_name: userName,
              ent_date: entDate,
              ent_time: entTime,
              computer_name: compName,
            },
            q
          );
        }

        if (ln.bill_date && Number(ln.bill_no) > 0) {
          await insertBillLine(
            comp_uid,
            {
              comp_code: cc,
              comp_year: cy,
              code: ln.code,
              vr_type,
              vr_date: vdt,
              vr_no,
              type: mtype,
              bill_date: ln.bill_date,
              bill_no: ln.bill_no,
              b_type: ln.b_type,
              dr_amt: ln.dr_amt,
              cr_amt: ln.cr_amt,
              detail,
              v_date: ln.v_date || vdt,
              bk_code: ln.bk_code,
            },
            q
          );
        }

        if (ln.cr_amt > 0) {
          receiptParty = ln.code;
          receiptCr = ln.cr_amt;
        }
      }

      if (mtype === 'R' && mode === 'new' && receiptParty && receiptCr > 0) {
        await insertHiReceipt(
          comp_uid,
          {
            comp_code: cc,
            comp_year: cy,
            vr_date: vdt,
            vr_no,
            user_name: userName,
            code: receiptParty,
            cr_amt: receiptCr,
          },
          q
        );
      }

      const trfCtx = {
        vr_type,
        vdt,
        vr_no,
        mtype,
        partyMeta,
        userName,
        entDate,
        entTime,
        compName,
      };
      let jv_vr_no_cd = 0;
      let jv_vr_no_int = 0;
      const hasCdLines = partyMeta.some((ln) => num(ln.cd_amt) > 0);
      const supportsCdInt = ['CV', 'BV', 'BI'].includes(vr_type);

      if (supportsCdInt && prevJv.jv_vr_no > 0) {
        try {
          await deleteVoucherBundle(cc, comp_uid, 'JV', vdt, prevJv.jv_vr_no, 'N', q);
        } catch (_) {}
      }
      if (supportsCdInt && prevJv.jv_vr_no_int > 0 && prevJv.jv_vr_no_int !== prevJv.jv_vr_no) {
        try {
          await deleteVoucherBundle(cc, comp_uid, 'JV', vdt, prevJv.jv_vr_no_int, 'N', q);
        } catch (_) {}
      }

      if (supportsCdInt) {
        jv_vr_no_cd = await runVoucherCdTransfer(
          cc,
          cy,
          comp_uid,
          globals,
          {
            ...trfCtx,
            reuseJvNo: mode === 'edit' ? prevJv.jv_vr_no : 0,
          },
          q,
          hasIndYnCol
        );
        if (hasCdLines && !jv_vr_no_cd) {
          throw new Error(
            'CD amount entered but journal voucher (JV) was not created. Set CD_CODE in Default Settings (yearsel).'
          );
        }

        try {
          jv_vr_no_int = await runVoucherIntTransfer(
            cc,
            cy,
            comp_uid,
            globals,
            {
              ...trfCtx,
              reuseJvNo: mode === 'edit' ? prevJv.jv_vr_no_int : 0,
            },
            q,
            hasIndYnCol
          );
        } catch (intErr) {
          console.error('Interest transfer (INTTRF) failed:', intErr.message);
        }
      }

      return {
        ok: true,
        message: mode === 'edit' ? 'Voucher updated.' : 'Voucher saved.',
        vr_type,
        vr_date: formatDateOut(vdt),
        vr_no,
        type: mtype,
        lines_written: partyMeta.length,
        jv_vr_no_cd,
        jv_vr_no_int,
      };
    });
  }

  function registerRoutes(app) {
    app.get('/api/voucher-entry/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, vr_type, vr_date } = req.query;
        if (!comp_code || !vr_date) {
          return res.status(400).json({ error: 'comp_code and vr_date are required' });
        }
        const vr_no = await fetchNextVrNo(
          comp_code,
          comp_uid,
          normCode(vr_type) || 'CV',
          vr_date
        );
        res.json({ ok: true, vr_no, vr_type: normCode(vr_type) || 'CV', vr_date: String(vr_date) });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/next-no error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/cash-context', async (req, res) => {
      try {
        const { comp_code, comp_uid, vr_date, cb_code, vr_type } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const ctx = await fetchCashContext(comp_code, comp_uid, vr_date, cb_code, vr_type);
        res.json({ ok: true, ...ctx });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/cash-context error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/default-cash', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const data = await fetchDefaultCashAccount(comp_code, comp_uid);
        res.json({ ok: true, ...data });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/default-cash error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/default-bank', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const data = await fetchDefaultBankAccount(comp_code, comp_uid);
        res.json({ ok: true, ...data });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/default-bank error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/lot-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, party_code, remarks } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const data = await fetchLotHelp(comp_code, comp_uid, party_code, remarks);
        res.json({ ok: true, style: data.style, rows: data.rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/lot-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/cost-help', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const rows = await fetchCostHelp(comp_code, comp_uid);
        res.json({ ok: true, rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/cost-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/bill-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, party_code, vr_date } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const rows = await fetchBillHelp(comp_code, comp_uid, party_code, vr_date);
        res.json({ ok: true, rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/bill-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/pending-bills', async (req, res) => {
      try {
        const {
          comp_code,
          comp_uid,
          code,
          schedule,
          v_date,
          pnd_bills,
          vou_int_show,
          pending_zero_yn,
          truck_no,
          rst_no,
          ind_yn,
        } = req.query;
        if (!comp_code || !code) {
          return res.status(400).json({ error: 'comp_code and code are required' });
        }
        const rows = await fetchPendingBills(
          comp_code,
          comp_uid,
          code,
          schedule,
          v_date,
          pnd_bills,
          vou_int_show,
          pending_zero_yn,
          truck_no,
          rst_no,
          ind_yn
        );
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/pending-bills error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry/print', async (req, res) => {
      try {
        const { comp_code, comp_uid, vr_type, vr_date, vr_no } = req.query;
        if (!comp_code || !vr_type || !vr_date || vr_no == null || vr_no === '') {
          return res.status(400).json({ error: 'comp_code, vr_type, vr_date, and vr_no are required' });
        }
        const data = await fetchVoucherPrint(comp_code, comp_uid, vr_type, vr_date, vr_no);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry/print error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/voucher-entry', async (req, res) => {
      try {
        const { comp_code, comp_uid, vr_type, vr_date, vr_no, quick } = req.query;
        if (!comp_code || !vr_type || !vr_date || vr_no == null || vr_no === '') {
          return res.status(400).json({ error: 'comp_code, vr_type, vr_date, and vr_no are required' });
        }
        const lightweight = String(quick ?? '1').trim() !== '0';
        const data = await loadVoucher(comp_code, comp_uid, vr_type, vr_date, vr_no, { lightweight });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry GET error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.post('/api/voucher-entry', async (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = body.comp_code ?? body.COMP_CODE;
        const comp_year = body.comp_year ?? body.COMP_YEAR ?? 0;
        const comp_uid = body.comp_uid ?? body.COMP_UID;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        const result = await saveCashVoucher(comp_code, comp_year, comp_uid, body, req);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry POST error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.delete('/api/voucher-entry', async (req, res) => {
      try {
        const q = req.query || {};
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = q.comp_code ?? body.comp_code ?? body.COMP_CODE;
        const comp_uid = q.comp_uid ?? body.comp_uid ?? body.COMP_UID;
        const vr_type = normCode(q.vr_type ?? body.vr_type ?? 'CV') || 'CV';
        const vr_date = q.vr_date ?? body.vr_date ?? body.VR_DATE;
        const vr_no = q.vr_no ?? body.vr_no ?? body.VR_NO;
        const voucherType = normType(q.type ?? body.type ?? body.TYPE ?? 'N');
        if (!comp_code || !vr_date || vr_no == null || vr_no === '') {
          return res.status(400).json({ error: 'comp_code, vr_date, and vr_no are required' });
        }
        const result = await deleteVoucherEntry(
          comp_code,
          comp_uid,
          vr_type,
          vr_date,
          vr_no,
          voucherType
        );
        res.json({
          ok: true,
          message:
            result.jv_deleted?.length > 0
              ? `Voucher deleted (linked JV: ${result.jv_deleted.join(', ')}).`
              : 'Voucher deleted.',
          jv_deleted: result.jv_deleted,
        });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ voucher-entry DELETE error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });
  }

  return { registerRoutes, fetchNextVrNo, loadVoucher, saveCashVoucher, deleteVoucherBundle, deleteVoucherEntry };
}

module.exports = { createVoucherEntry };
