/**
 * Consignment Stock Entry — VFP DO FORM cstock WITH 'PC',G_BLNKDT,0,''
 * Primary table: CPUR (TYPE='PC'). Stock ledger: LOTSTOCK (VR_TYPE='PC', E_TYPE='R').
 */

'use strict';

const CPUR_TYPE = 'PC';

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

function yn(v, def = 'N') {
  const s = String(v ?? def).trim().toUpperCase().slice(0, 1);
  if (s === 'Y' || s === 'N' || s === 'I') return s;
  return def === 'Y' ? 'Y' : 'N';
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
  if (dmy) return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`;
  return s;
}

function resolveUserName(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const q = req?.query && typeof req.query === 'object' ? req.query : {};
  return String(b.user_name ?? b.USER_NAME ?? q.user_name ?? q.USER_NAME ?? req?.user?.name ?? '').trim();
}

const CPUR_INSERT_FIELDS = [
  { col: 'COMP_CODE', bind: 'comp_code' },
  { col: 'COMP_YEAR', bind: 'comp_year' },
  { col: 'TYPE', bind: 'type' },
  { col: 'R_NO', bind: 'r_no' },
  { col: 'R_DATE', bind: 'r_date' },
  { col: 'B_NO', bind: 'b_no' },
  { col: 'ITEM_CODE', bind: 'item_code' },
  { col: 'LOT', bind: 'lot' },
  { col: 'STATUS', bind: 'status' },
  { col: 'SUP_CODE', bind: 'sup_code' },
  { col: 'QNTY', bind: 'qnty' },
  { col: 'WEIGHT', bind: 'weight' },
  { col: 'RATE', bind: 'rate' },
  { col: 'AMOUNT', bind: 'amount' },
  { col: 'REMARKS', bind: 'remarks' },
  { col: 'BAGS', bind: 'bags' },
  { col: 'KATTA', bind: 'katta' },
  { col: 'HKATTA', bind: 'hkatta' },
  { col: 'MSUP_CODE', bind: 'msup_code' },
  { col: 'EXP_CAT', bind: 'exp_cat' },
  { col: 'LABOUR', bind: 'labour' },
  { col: 'F_FORM', bind: 'f_form' },
  { col: 'GOD_CODE', bind: 'god_code' },
  { col: 'COST_CODE', bind: 'cost_code' },
  { col: 'GR_NO', bind: 'gr_no' },
  { col: 'TRUCK_NO', bind: 'truck_no' },
  { col: 'TPT', bind: 'tpt' },
  { col: 'CH_NO', bind: 'ch_no' },
  { col: 'CH_DATE', bind: 'ch_date' },
  { col: 'L_C', bind: 'l_c' },
  { col: 'CGST_PER', bind: 'cgst_per' },
  { col: 'CGST_AMT', bind: 'cgst_amt' },
  { col: 'SGST_PER', bind: 'sgst_per' },
  { col: 'SGST_AMT', bind: 'sgst_amt' },
  { col: 'IGST_PER', bind: 'igst_per' },
  { col: 'IGST_AMT', bind: 'igst_amt' },
  { col: 'CGST_CODE', bind: 'cgst_code' },
  { col: 'SGST_CODE', bind: 'sgst_code' },
  { col: 'IGST_CODE', bind: 'igst_code' },
  { col: 'MOD_REASON', bind: 'mod_reason' },
  { col: 'USER_NAME', bind: 'user_name' },
  { col: 'ENT_DATE', expr: 'SYSDATE' },
];

function createConsignmentStock({ runQuery, parseDateOnly, withCompTransaction }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createConsignmentStock requires runQuery and parseDateOnly');
  }

  const columnCache = new Map();

  function formatDateBind(raw) {
    if (typeof parseDateOnly === 'function') {
      const d = parseDateOnly(raw);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    }
    const s = String(raw || '').trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
    if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return null;
  }

  async function getCpurColumns(comp_uid) {
    const key = String(comp_uid || '_default').trim().toUpperCase();
    if (columnCache.has(key)) return columnCache.get(key);
    try {
      const rows = await runQuery(
        `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'CPUR' ORDER BY COLUMN_ID`,
        {},
        comp_uid
      );
      const set = new Set((rows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name).toUpperCase()));
      columnCache.set(key, set);
      return set;
    } catch {
      const fallback = new Set(CPUR_INSERT_FIELDS.map((f) => f.col));
      columnCache.set(key, fallback);
      return fallback;
    }
  }

  function buildInsertSql(cols) {
    const active = CPUR_INSERT_FIELDS.filter((f) => cols.has(f.col));
    const names = active.map((f) => f.col).join(', ');
    const vals = active
      .map((f) => {
        if (f.expr) return f.expr;
        if (f.col === 'R_DATE' || f.col === 'CH_DATE') return `:${f.bind}`;
        return `:${f.bind}`;
      })
      .join(', ');
    return { sql: `INSERT INTO CPUR (${names}) VALUES (${vals})`, active };
  }

  function deriveStatus(bags, katta, hkatta) {
    if (num(bags)) return 'B';
    if (num(katta)) return 'K';
    if (num(hkatta)) return 'H';
    return 'B';
  }

  function mapRow(r) {
    return {
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      lot: Number(r.LOT ?? r.lot ?? 0) || 0,
      status: String(r.STATUS ?? r.status ?? '').trim().toUpperCase(),
      sup_code: normCode(r.SUP_CODE ?? r.sup_code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      bags: num(r.BAGS ?? r.bags),
      katta: num(r.KATTA ?? r.katta),
      hkatta: num(r.HKATTA ?? r.hkatta),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      god_name: String(r.GOD_NAME ?? r.god_name ?? '').trim(),
      gr_no: String(r.GR_NO ?? r.gr_no ?? '').trim(),
      truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
      tpt: String(r.TPT ?? r.tpt ?? '').trim(),
      ch_no: String(r.CH_NO ?? r.ch_no ?? '').trim(),
      ch_date: formatDateOut(r.CH_DATE ?? r.ch_date),
      exp_cat: String(r.EXP_CAT ?? r.exp_cat ?? '').trim().toUpperCase(),
      f_form: yn(r.F_FORM ?? r.f_form, 'N'),
      labour: yn(r.LABOUR ?? r.labour, 'N'),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      msup_code: normCode(r.MSUP_CODE ?? r.msup_code),
      msup_name: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      cost_name: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
      l_c: String(r.L_C ?? r.l_c ?? '').trim().toUpperCase().slice(0, 1),
      cgst_per: num(r.CGST_PER ?? r.cgst_per),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_per: num(r.SGST_PER ?? r.sgst_per),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_per: num(r.IGST_PER ?? r.igst_per),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
      cgst_code: normCode(r.CGST_CODE ?? r.cgst_code),
      sgst_code: normCode(r.SGST_CODE ?? r.sgst_code),
      igst_code: normCode(r.IGST_CODE ?? r.igst_code),
      mod_reason: String(r.MOD_REASON ?? r.mod_reason ?? '').trim(),
    };
  }

  async function nextNo(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT NVL(MAX(R_NO), 0) + 1 AS NEXT_NO
       FROM CPUR
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type`,
      { comp_code: cc, type: CPUR_TYPE },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  /** VFP cstock — Bikri No. (B_NO) = last + 1 for TYPE PC. */
  async function nextBno(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT NVL(MAX(B_NO), 0) + 1 AS NEXT_BNO
       FROM CPUR
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type`,
      { comp_code: cc, type: CPUR_TYPE },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_BNO ?? rows?.[0]?.next_bno ?? 1) || 1;
  }

  async function listItems(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT ITEM_NAME, ITEM_CODE, NVL(P_CODE, '') AS P_CODE, NVL(S_CODE, '') AS S_CODE
       FROM ITEMMAST
       WHERE COMP_CODE = :comp_code
       ORDER BY ITEM_NAME`,
      { comp_code: cc },
      comp_uid
    );
    return rows || [];
  }

  /** VFP cstock party/msup — SUBSTR(CODE,1,1) IN ('S','T'). */
  async function listSuppliers(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT NAME, CITY, CODE, GST_NO, PAN, TEL_NO_O
       FROM MASTER
       WHERE COMP_CODE = :comp_code
         AND (UPPER(SUBSTR(TRIM(CODE), 1, 1)) = 'S' OR UPPER(SUBSTR(TRIM(CODE), 1, 1)) = 'T')
       ORDER BY NAME, CITY, CODE`,
      { comp_code: cc },
      comp_uid
    );
    return rows || [];
  }

  async function nextLot(comp_code, comp_uid, item_code) {
    const cc = Number(comp_code) || 0;
    const item = Number(item_code) || 0;
    if (!item) return 1;
    const rows = await runQuery(
      `SELECT NVL(MAX(LOT), 0) + 1 AS NEXT_LOT
       FROM CPUR
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type AND ITEM_CODE = :item_code`,
      { comp_code: cc, type: CPUR_TYPE, item_code: item },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_LOT ?? rows?.[0]?.next_lot ?? 1) || 1;
  }

  async function loadOne(comp_code, comp_uid, r_no, r_date) {
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    if (!no) {
      const err = new Error('Sr.No. is required.');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, type: CPUR_TYPE, r_no: no };
    let sql = `
      SELECT A.*,
             I.ITEM_NAME,
             P.NAME AS PARTY_NAME,
             M.NAME AS MSUP_NAME,
             C.COST_NAME,
             G.GOD_NAME
      FROM CPUR A
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      LEFT JOIN MASTER P ON A.COMP_CODE = P.COMP_CODE AND A.SUP_CODE = P.CODE
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.MSUP_CODE = M.CODE
      LEFT JOIN COST C ON A.COMP_CODE = C.COMP_CODE AND A.COST_CODE = C.COST_CODE
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = :type AND A.R_NO = :r_no`;
    const d = formatDateBind(r_date);
    if (d) {
      sql += ' AND TRUNC(A.R_DATE) = TRUNC(:r_date)';
      binds.r_date = d;
    }
    sql += ' ORDER BY A.R_DATE DESC';
    let rows;
    try {
      rows = await runQuery(sql, binds, comp_uid);
    } catch (err) {
      if (!/ORA-00904|ORA-00942|invalid identifier/i.test(String(err.message || ''))) throw err;
      rows = await runQuery(
        `SELECT A.* FROM CPUR A
         WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = :type AND A.R_NO = :r_no
         ORDER BY A.R_DATE DESC`,
        { comp_code: cc, type: CPUR_TYPE, r_no: no },
        comp_uid
      );
    }
    if (!rows?.length) {
      const err = new Error('Consignment stock entry not found.');
      err.status = 404;
      throw err;
    }
    return { ok: true, type: CPUR_TYPE, header: mapRow(rows[0]) };
  }

  async function navigate(comp_code, comp_uid, direction, currentNo) {
    const cc = Number(comp_code) || 0;
    const cur = Number(currentNo) || 0;
    let sql;
    let binds = { comp_code: cc, type: CPUR_TYPE };
    const dir = String(direction || '').toLowerCase();
    if (dir === 'top') {
      sql = `SELECT MIN(R_NO) AS R_NO FROM CPUR WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type`;
    } else if (dir === 'bottom') {
      sql = `SELECT MAX(R_NO) AS R_NO FROM CPUR WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type`;
    } else if (dir === 'next') {
      sql = `SELECT MIN(R_NO) AS R_NO FROM CPUR WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type AND R_NO > :cur`;
      binds.cur = cur;
    } else if (dir === 'prev' || dir === 'previous') {
      sql = `SELECT MAX(R_NO) AS R_NO FROM CPUR WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type AND R_NO < :cur`;
      binds.cur = cur;
    } else {
      const err = new Error('direction must be top|bottom|next|prev');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(sql, binds, comp_uid);
    const no = Number(rows?.[0]?.R_NO ?? rows?.[0]?.r_no ?? 0) || 0;
    if (!no) {
      const err = new Error('No more records.');
      err.status = 404;
      throw err;
    }
    return loadOne(comp_code, comp_uid, no);
  }

  async function checklistRows(comp_code, comp_uid, filters = {}) {
    const cc = Number(comp_code) || 0;
    const mode = String(filters.mode || 'C').trim().toUpperCase().slice(0, 1) || 'C';
    let typeClause = `TRIM(A.TYPE) = 'PC'`;
    if (mode === 'P') typeClause = `TRIM(A.TYPE) IN ('PU','P')`;
    else if (mode === 'B') typeClause = `TRIM(A.TYPE) IN ('PC','PU','P')`;

    const binds = { comp_code: cc };
    let where = `A.COMP_CODE = :comp_code AND ${typeClause}`;
    if (filters.sdt) {
      const sdt = formatDateBind(filters.sdt);
      if (sdt) {
        where += ' AND TRUNC(A.R_DATE) >= TRUNC(:sdt)';
        binds.sdt = sdt;
      }
    }
    if (filters.edt) {
      const edt = formatDateBind(filters.edt);
      if (edt) {
        where += ' AND TRUNC(A.R_DATE) <= TRUNC(:edt)';
        binds.edt = edt;
      }
    }
    if (filters.party || filters.code) {
      where += ' AND TRIM(A.SUP_CODE) = TRIM(:party)';
      binds.party = normCode(filters.party || filters.code);
    }
    if (filters.msup_code) {
      where += ' AND TRIM(A.MSUP_CODE) = TRIM(:msup_code)';
      binds.msup_code = normCode(filters.msup_code);
    }
    if (filters.item_code && Number(filters.item_code)) {
      where += ' AND A.ITEM_CODE = :item_code';
      binds.item_code = Number(filters.item_code) || 0;
    }
    if (filters.god_code) {
      where += ' AND TRIM(A.GOD_CODE) = TRIM(:god_code)';
      binds.god_code = normCode(filters.god_code);
    }

    const sql = `
      SELECT A.TYPE, A.R_NO, TRUNC(A.R_DATE) AS R_DATE, A.B_NO, A.ITEM_CODE, I.ITEM_NAME,
             A.LOT, A.GOD_CODE, G.GOD_NAME, A.SUP_CODE, P.NAME AS PARTY_NAME,
             A.BAGS, A.KATTA, A.HKATTA, A.WEIGHT, A.AMOUNT, A.RATE,
             A.F_FORM, A.LABOUR, A.L_C, A.EXP_CAT, A.TRUCK_NO, A.GR_NO, A.REMARKS,
             A.MSUP_CODE, M.NAME AS MSUP_NAME
      FROM CPUR A
      LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
      LEFT JOIN MASTER P ON A.COMP_CODE = P.COMP_CODE AND A.SUP_CODE = P.CODE
      LEFT JOIN MASTER M ON A.COMP_CODE = M.COMP_CODE AND A.MSUP_CODE = M.CODE
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
      WHERE ${where}
      ORDER BY A.R_DATE, A.R_NO`;

    let rows;
    try {
      rows = await runQuery(sql, binds, comp_uid);
    } catch (err) {
      if (!/ORA-00904|ORA-00942|invalid identifier/i.test(String(err.message || ''))) throw err;
      rows = await runQuery(
        `SELECT A.TYPE, A.R_NO, TRUNC(A.R_DATE) AS R_DATE, A.B_NO, A.ITEM_CODE, A.LOT, A.GOD_CODE,
                A.SUP_CODE, A.BAGS, A.KATTA, A.HKATTA, A.WEIGHT, A.AMOUNT, A.RATE,
                A.F_FORM, A.LABOUR, A.EXP_CAT, A.TRUCK_NO, A.GR_NO, A.REMARKS, A.MSUP_CODE
         FROM CPUR A
         WHERE ${where}
         ORDER BY A.R_DATE, A.R_NO`,
        binds,
        comp_uid
      );
    }

    const mapped = (rows || []).map((r) => ({
      type: String(r.TYPE ?? r.type ?? '').trim().toUpperCase(),
      r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
      r_date: formatDateOut(r.R_DATE ?? r.r_date),
      b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      lot: Number(r.LOT ?? r.lot ?? 0) || 0,
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      god_name: String(r.GOD_NAME ?? r.god_name ?? '').trim(),
      sup_code: normCode(r.SUP_CODE ?? r.sup_code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      bags: num(r.BAGS ?? r.bags),
      katta: num(r.KATTA ?? r.katta),
      hkatta: num(r.HKATTA ?? r.hkatta),
      weight: num(r.WEIGHT ?? r.weight),
      amount: num(r.AMOUNT ?? r.amount),
      rate: num(r.RATE ?? r.rate),
      f_form: yn(r.F_FORM ?? r.f_form, 'N'),
      labour: yn(r.LABOUR ?? r.labour, 'N'),
      l_c: String(r.L_C ?? r.l_c ?? '').trim().toUpperCase(),
      exp_cat: String(r.EXP_CAT ?? r.exp_cat ?? '').trim().toUpperCase(),
      truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
      gr_no: String(r.GR_NO ?? r.gr_no ?? '').trim(),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      msup_code: normCode(r.MSUP_CODE ?? r.msup_code),
      msup_name: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
    }));

    let totBags = 0;
    let totKatta = 0;
    let totHkatta = 0;
    let totWeight = 0;
    let totAmount = 0;
    for (const row of mapped) {
      totBags += row.bags;
      totKatta += row.katta;
      totHkatta += row.hkatta;
      totWeight += row.weight;
      totAmount += row.amount;
    }
    return {
      ok: true,
      rows: mapped,
      totals: {
        bags: totBags,
        katta: totKatta,
        hkatta: totHkatta,
        weight: totWeight,
        amount: totAmount,
      },
    };
  }

  async function listRows(comp_code, comp_uid, filters = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc, type: CPUR_TYPE };
    let where = 'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = :type';
    if (filters.sdt) {
      const sdt = formatDateBind(filters.sdt);
      if (sdt) {
        where += ' AND TRUNC(A.R_DATE) >= TRUNC(:sdt)';
        binds.sdt = sdt;
      }
    }
    if (filters.edt) {
      const edt = formatDateBind(filters.edt);
      if (edt) {
        where += ' AND TRUNC(A.R_DATE) <= TRUNC(:edt)';
        binds.edt = edt;
      }
    }
    if (filters.party) {
      where += ' AND TRIM(A.SUP_CODE) = TRIM(:party)';
      binds.party = normCode(filters.party);
    }
    if (filters.item_code) {
      where += ' AND A.ITEM_CODE = :item_code';
      binds.item_code = Number(filters.item_code) || 0;
    }

    const mapList = (rows) =>
      (rows || []).map((r) => ({
        r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
        r_date: formatDateOut(r.R_DATE ?? r.r_date),
        b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        lot: Number(r.LOT ?? r.lot ?? 0) || 0,
        sup_code: normCode(r.SUP_CODE ?? r.sup_code),
        party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
        weight: num(r.WEIGHT ?? r.weight),
        amount: num(r.AMOUNT ?? r.amount),
        bags: num(r.BAGS ?? r.bags),
        katta: num(r.KATTA ?? r.katta),
        hkatta: num(r.HKATTA ?? r.hkatta),
      }));

    try {
      const rows = await runQuery(
        `SELECT A.R_NO, TRUNC(A.R_DATE) AS R_DATE, A.B_NO, A.ITEM_CODE, I.ITEM_NAME,
                A.LOT, A.SUP_CODE, P.NAME AS PARTY_NAME, A.WEIGHT, A.AMOUNT, A.BAGS, A.KATTA, A.HKATTA
         FROM CPUR A
         LEFT JOIN ITEMMAST I ON A.COMP_CODE = I.COMP_CODE AND A.ITEM_CODE = I.ITEM_CODE
         LEFT JOIN MASTER P ON A.COMP_CODE = P.COMP_CODE AND A.SUP_CODE = P.CODE
         WHERE ${where}
         ORDER BY A.R_DATE DESC, A.R_NO DESC`,
        binds,
        comp_uid
      );
      return mapList(rows);
    } catch (err) {
      if (!/ORA-00904|ORA-00942|invalid identifier/i.test(String(err.message || ''))) throw err;
      const rows = await runQuery(
        `SELECT A.R_NO, TRUNC(A.R_DATE) AS R_DATE, A.B_NO, A.ITEM_CODE, A.LOT, A.SUP_CODE,
                A.WEIGHT, A.AMOUNT, A.BAGS, A.KATTA, A.HKATTA
         FROM CPUR A
         WHERE ${where}
         ORDER BY A.R_DATE DESC, A.R_NO DESC`,
        binds,
        comp_uid
      );
      return mapList(rows);
    }
  }

  async function getLotstockColumns(comp_uid) {
    const key = `LS_${String(comp_uid || '_default').trim().toUpperCase()}`;
    if (columnCache.has(key)) return columnCache.get(key);
    try {
      const rows = await runQuery(
        `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'LOTSTOCK' ORDER BY COLUMN_ID`,
        {},
        comp_uid
      );
      const set = new Set((rows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name).toUpperCase()));
      columnCache.set(key, set);
      return set;
    } catch {
      return null;
    }
  }

  async function syncLotstock(exec, cc, cy, header, rDateBind, lotCols) {
    const key = {
      comp_code: cc,
      vr_type: CPUR_TYPE,
      vr_date: rDateBind,
      vr_no: Number(header.r_no) || 0,
    };
    await exec(
      `DELETE FROM LOTSTOCK
       WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :vr_type
         AND TRUNC(VR_DATE) = TRUNC(:vr_date) AND VR_NO = :vr_no`,
      key
    );

    const allFields = [
      { col: 'COMP_CODE', bind: 'comp_code' },
      { col: 'COMP_YEAR', bind: 'comp_year' },
      { col: 'VR_TYPE', bind: 'vr_type' },
      { col: 'VR_DATE', bind: 'vr_date' },
      { col: 'VR_NO', bind: 'vr_no' },
      { col: 'E_TYPE', bind: 'e_type' },
      { col: 'SUP_CODE', bind: 'sup_code' },
      { col: 'ITEM_CODE', bind: 'item_code' },
      { col: 'STATUS', bind: 'status' },
      { col: 'QNTY', bind: 'qnty' },
      { col: 'WEIGHT', bind: 'weight' },
      { col: 'AMOUNT', bind: 'amount' },
      { col: 'LOT', bind: 'lot' },
      { col: 'B_NO', bind: 'b_no' },
      { col: 'GOD_CODE', bind: 'god_code' },
      { col: 'EXP_CAT', bind: 'exp_cat' },
      { col: 'GR_NO', bind: 'gr_no' },
      { col: 'TRUCK_NO', bind: 'truck_no' },
      { col: 'TPT', bind: 'tpt' },
      { col: 'CH_NO', bind: 'ch_no' },
      { col: 'CH_DATE', bind: 'ch_date' },
      { col: 'F_FORM', bind: 'f_form' },
      { col: 'LABOUR', bind: 'labour' },
      { col: 'REMARKS', bind: 'remarks' },
      { col: 'SUP_DATE', bind: 'sup_date' },
      { col: 'MSUP_CODE', bind: 'msup_code' },
      { col: 'COST_CODE', bind: 'cost_code' },
      { col: 'G_WEIGHT', bind: 'g_weight' },
      { col: 'A_WEIGHT', bind: 'a_weight' },
    ];
    const active = lotCols ? allFields.filter((f) => lotCols.has(f.col)) : allFields;
    if (!active.length) {
      const err = new Error('LOTSTOCK table/columns not available.');
      err.status = 500;
      throw err;
    }

    const pushLine = async (status, qty, weight, amount) => {
      if (!num(qty) && !num(weight) && !num(amount)) return;
      const allBinds = {
        comp_code: cc,
        comp_year: cy,
        vr_type: CPUR_TYPE,
        vr_date: rDateBind,
        vr_no: Number(header.r_no) || 0,
        e_type: 'R',
        status,
        qnty: num(qty),
        weight: num(weight),
        amount: num(amount),
        lot: Number(header.lot) || 0,
        b_no: Number(header.b_no) || 0,
        item_code: Number(header.item_code) || 0,
        sup_code: normCode(header.sup_code),
        god_code: normCode(header.god_code) || null,
        exp_cat: String(header.exp_cat || '').trim() || null,
        gr_no: String(header.gr_no || '').trim() || null,
        truck_no: String(header.truck_no || '').trim() || null,
        tpt: String(header.tpt || '').trim() || null,
        ch_no: String(header.ch_no || '').trim() || null,
        ch_date: formatDateBind(header.ch_date),
        f_form: yn(header.f_form, 'N'),
        labour: yn(header.labour, 'N'),
        remarks: String(header.remarks || '').trim() || null,
        sup_date: rDateBind,
        msup_code: normCode(header.msup_code) || normCode(header.sup_code) || null,
        cost_code: normCode(header.cost_code) || null,
        g_weight: num(weight),
        a_weight: num(weight),
      };
      const binds = {};
      for (const f of active) binds[f.bind] = allBinds[f.bind];
      const cols = active.map((f) => f.col).join(', ');
      const vals = active.map((f) => `:${f.bind}`).join(', ');
      await exec(`INSERT INTO LOTSTOCK (${cols}) VALUES (${vals})`, binds);
    };

    const bags = num(header.bags);
    const katta = num(header.katta);
    const hkatta = num(header.hkatta);
    let w = num(header.weight);
    let a = num(header.amount);
    let posted = false;
    if (bags) {
      await pushLine('B', bags, w, a);
      w = 0;
      a = 0;
      posted = true;
    }
    if (katta) {
      await pushLine('K', katta, w, a);
      w = 0;
      a = 0;
      posted = true;
    }
    if (hkatta) {
      await pushLine('H', hkatta, w, a);
      posted = true;
    }
    if (!posted) {
      await pushLine(deriveStatus(bags, katta, hkatta), num(header.qnty) || 0, num(header.weight), num(header.amount));
    }
  }

  async function fetchLotstockRows(comp_code, comp_uid, r_no, r_date) {
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    if (!no || !d) return [];
    try {
      const rows = await runQuery(
        `SELECT L.VR_NO, TRUNC(L.VR_DATE) AS VR_DATE, L.E_TYPE, L.STATUS, L.ITEM_CODE, I.ITEM_NAME,
                L.LOT, L.B_NO, L.SUP_CODE, L.QNTY, L.WEIGHT, L.AMOUNT, L.GOD_CODE, L.REMARKS
         FROM LOTSTOCK L
         LEFT JOIN ITEMMAST I ON L.COMP_CODE = I.COMP_CODE AND L.ITEM_CODE = I.ITEM_CODE
         WHERE L.COMP_CODE = :comp_code AND TRIM(L.VR_TYPE) = :vr_type
           AND L.VR_NO = :vr_no AND TRUNC(L.VR_DATE) = TRUNC(:vr_date)
         ORDER BY L.STATUS, L.LOT`,
        { comp_code: cc, vr_type: CPUR_TYPE, vr_no: no, vr_date: d },
        comp_uid
      );
      return (rows || []).map((r) => ({
        vr_no: Number(r.VR_NO ?? r.vr_no ?? 0) || 0,
        vr_date: formatDateOut(r.VR_DATE ?? r.vr_date),
        e_type: String(r.E_TYPE ?? r.e_type ?? '').trim(),
        status: String(r.STATUS ?? r.status ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        lot: Number(r.LOT ?? r.lot ?? 0) || 0,
        b_no: Number(r.B_NO ?? r.b_no ?? 0) || 0,
        sup_code: normCode(r.SUP_CODE ?? r.sup_code),
        qnty: num(r.QNTY ?? r.qnty),
        weight: num(r.WEIGHT ?? r.weight),
        amount: num(r.AMOUNT ?? r.amount),
        god_code: normCode(r.GOD_CODE ?? r.god_code),
        remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      }));
    } catch (err) {
      if (/ORA-00904|ORA-00942|invalid identifier/i.test(String(err.message || ''))) return [];
      throw err;
    }
  }

  async function postToLotstock(comp_code, comp_uid, comp_year, r_no, r_date) {
    const loaded = await loadOne(comp_code, comp_uid, r_no, r_date);
    const header = loaded.header;
    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || Number(header.comp_year) || 0;
    const rDateBind = formatDateBind(header.r_date || r_date);
    if (!rDateBind) {
      const err = new Error('Date is required for posting.');
      err.status = 400;
      throw err;
    }
    const lotCols = await getLotstockColumns(comp_uid);
    const runTx =
      typeof withCompTransaction === 'function'
        ? (fn) => withCompTransaction(comp_uid, fn)
        : async (fn) => {
            const exec = (q, b) => runQuery(q, b, comp_uid, { autoCommit: true });
            return fn(exec);
          };
    await runTx(async (exec) => {
      await syncLotstock(exec, cc, cy, header, rDateBind, lotCols);
    });
    const rows = await fetchLotstockRows(comp_code, comp_uid, header.r_no, header.r_date);
    return { ok: true, posted: rows.length, rows, header };
  }

  async function saveVoucher(body, user) {
    const cc = Number(body.comp_code) || 0;
    const cy = Number(body.comp_year) || 0;
    const comp_uid = body.comp_uid;
    const h = body.header || body;
    const rDateBind = formatDateBind(h.r_date);
    if (!rDateBind) {
      const err = new Error('Date is required.');
      err.status = 400;
      throw err;
    }
    if (!Number(h.item_code)) {
      const err = new Error('Item Code is required.');
      err.status = 400;
      throw err;
    }
    if (!normCode(h.sup_code)) {
      const err = new Error('Party is required.');
      err.status = 400;
      throw err;
    }

    let rNo = Number(h.r_no) || 0;
    if (!rNo) rNo = await nextNo(cc, comp_uid);
    let lot = Number(h.lot) || 0;
    if (!lot) lot = await nextLot(cc, comp_uid, h.item_code);

    const bags = num(h.bags);
    const katta = num(h.katta);
    const hkatta = num(h.hkatta);
    const weight = num(h.weight);
    const rate = num(h.rate);
    let amount = num(h.amount);
    if (!amount && weight && rate) amount = Math.round(weight * rate * 100) / 100;

    const header = {
      ...h,
      r_no: rNo,
      lot,
      bags,
      katta,
      hkatta,
      weight,
      rate,
      amount,
      status: deriveStatus(bags, katta, hkatta),
      qnty: bags + katta + hkatta,
    };

    const cols = await getCpurColumns(comp_uid);
    const { sql, active } = buildInsertSql(cols);
    const allBinds = {
      comp_code: cc,
      comp_year: cy,
      type: CPUR_TYPE,
      r_no: rNo,
      r_date: rDateBind,
      b_no: Number(header.b_no) || 0,
      item_code: Number(header.item_code) || 0,
      lot,
      status: header.status,
      sup_code: normCode(header.sup_code),
      qnty: header.qnty,
      weight,
      rate,
      amount,
      remarks: String(header.remarks || '').trim() || null,
      bags,
      katta,
      hkatta,
      msup_code: normCode(header.msup_code) || null,
      exp_cat: String(header.exp_cat || '').trim().toUpperCase() || null,
      labour: yn(header.labour, 'N'),
      f_form: yn(header.f_form, 'N'),
      god_code: normCode(header.god_code) || null,
      cost_code: normCode(header.cost_code) || null,
      gr_no: String(header.gr_no || '').trim() || null,
      truck_no: String(header.truck_no || '').trim() || null,
      tpt: String(header.tpt || '').trim() || null,
      ch_no: String(header.ch_no || '').trim() || null,
      ch_date: formatDateBind(header.ch_date),
      l_c: String(header.l_c || '').trim().toUpperCase().slice(0, 1) || null,
      cgst_per: num(header.cgst_per),
      cgst_amt: num(header.cgst_amt),
      sgst_per: num(header.sgst_per),
      sgst_amt: num(header.sgst_amt),
      igst_per: num(header.igst_per),
      igst_amt: num(header.igst_amt),
      cgst_code: normCode(header.cgst_code) || null,
      sgst_code: normCode(header.sgst_code) || null,
      igst_code: normCode(header.igst_code) || null,
      mod_reason: String(header.mod_reason || '').trim() || null,
      user_name: user || 'WEB',
    };
    const binds = {};
    for (const f of active) {
      if (!f.bind) continue;
      binds[f.bind] = allBinds[f.bind];
    }

    const runTx =
      typeof withCompTransaction === 'function'
        ? (fn) => withCompTransaction(comp_uid, fn)
        : async (fn) => {
            const exec = (q, b) => runQuery(q, b, comp_uid, { autoCommit: true });
            return fn(exec);
          };

    await runTx(async (exec) => {
      await exec(
        `DELETE FROM CPUR
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type AND R_NO = :r_no
           AND TRUNC(R_DATE) = TRUNC(:r_date)`,
        { comp_code: cc, type: CPUR_TYPE, r_no: rNo, r_date: rDateBind }
      );
      await exec(sql, binds);
    });

    return loadOne(cc, comp_uid, rNo, formatDateOut(rDateBind));
  }

  async function deleteVoucher(comp_code, comp_uid, r_no, r_date, mod_reason) {
    const cc = Number(comp_code) || 0;
    const no = Number(r_no) || 0;
    const d = formatDateBind(r_date);
    if (!no || !d) {
      const err = new Error('Sr.No. and Date are required.');
      err.status = 400;
      throw err;
    }
    const runTx =
      typeof withCompTransaction === 'function'
        ? (fn) => withCompTransaction(comp_uid, fn)
        : async (fn) => {
            const exec = (q, b) => runQuery(q, b, comp_uid, { autoCommit: true });
            return fn(exec);
          };

    await runTx(async (exec) => {
      if (mod_reason) {
        try {
          await exec(
            `UPDATE CPUR SET MOD_REASON = :mod_reason
             WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type AND R_NO = :r_no
               AND TRUNC(R_DATE) = TRUNC(:r_date)`,
            { mod_reason: String(mod_reason).trim(), comp_code: cc, type: CPUR_TYPE, r_no: no, r_date: d }
          );
        } catch {
          /* optional */
        }
      }
      await exec(
        `DELETE FROM LOTSTOCK
         WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = :type
           AND TRUNC(VR_DATE) = TRUNC(:r_date) AND VR_NO = :r_no`,
        { comp_code: cc, type: CPUR_TYPE, r_date: d, r_no: no }
      ).catch(() => {});
      await exec(
        `DELETE FROM CPUR
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = :type AND R_NO = :r_no
           AND TRUNC(R_DATE) = TRUNC(:r_date)`,
        { comp_code: cc, type: CPUR_TYPE, r_no: no, r_date: d }
      );
    });
    return { ok: true };
  }

  function registerRoutes(app) {
    app.get('/api/consignment-stock/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        const [next_no, next_bno] = await Promise.all([
          nextNo(comp_code, comp_uid),
          nextBno(comp_code, comp_uid),
        ]);
        res.json({ ok: true, next_no, next_bno });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/items', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        res.json({ ok: true, items: await listItems(comp_code, comp_uid) });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/suppliers', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        res.json({ ok: true, accounts: await listSuppliers(comp_code, comp_uid) });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/next-lot', async (req, res) => {
      try {
        const { comp_code, comp_uid, item_code } = req.query;
        res.json({ ok: true, next_lot: await nextLot(comp_code, comp_uid, item_code) });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, sdt, edt, party, item_code } = req.query;
        res.json({ ok: true, rows: await listRows(comp_code, comp_uid, { sdt, edt, party, item_code }) });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/checklist', async (req, res) => {
      try {
        const { comp_code, comp_uid, sdt, edt, party, code, msup_code, item_code, god_code, mode } = req.query;
        res.json(
          await checklistRows(comp_code, comp_uid, {
            sdt,
            edt,
            party: party || code,
            code,
            msup_code,
            item_code,
            god_code,
            mode,
          })
        );
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/nav', async (req, res) => {
      try {
        const { comp_code, comp_uid, direction, r_no } = req.query;
        res.json(await navigate(comp_code, comp_uid, direction, r_no));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_no, r_date } = req.query;
        res.json(await loadOne(comp_code, comp_uid, r_no, r_date));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/consignment-stock', async (req, res) => {
      try {
        const body = req.body || {};
        const user = resolveUserName(body, req) || 'WEB';
        res.json(await saveVoucher(body, user));
      } catch (err) {
        console.error('❌ consignment-stock save:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/consignment-stock/posting', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_no, r_date } = req.query;
        const rows = await fetchLotstockRows(comp_code, comp_uid, r_no, r_date);
        res.json({ ok: true, rows });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/consignment-stock/post', async (req, res) => {
      try {
        const body = req.body || {};
        const { comp_code, comp_uid, comp_year, r_no, r_date } = body;
        res.json(await postToLotstock(comp_code, comp_uid, comp_year, r_no, r_date));
      } catch (err) {
        console.error('❌ consignment-stock post:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.delete('/api/consignment-stock', async (req, res) => {
      try {
        const { comp_code, comp_uid, r_no, r_date, mod_reason } = req.query;
        res.json(await deleteVoucher(comp_code, comp_uid, r_no, r_date, mod_reason));
      } catch (err) {
        console.error('❌ consignment-stock delete:', err.message);
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  }

  return { registerRoutes, loadOne, saveVoucher, deleteVoucher };
}

module.exports = { createConsignmentStock };
