/**
 * Purchase Order entry — VFP DO FORM PORDER WITH 'SO' → PORDER.TYPE = 'SO'.
 */

'use strict';

const { createPurchaseOrderPending } = require('./purchaseOrderPending.cjs');

const PO_TYPE = 'SO';

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

function normStatus(v) {
  const s = String(v ?? 'B').trim().toUpperCase();
  return s || 'B';
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

function entTimeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function calcLineAmount(line, defaultQw = 'W') {
  const rate = num(line.rate);
  const mode = String(line.amt_cal ?? line.AMT_CAL ?? defaultQw).trim().toUpperCase() || defaultQw;
  const base = mode === 'Q' ? num(line.qnty) : num(line.weight);
  return Math.round(base * rate * 100) / 100;
}

/** VFP usertst.prg — PORDER uses USERS.F9: pos 1–4 = access, add, edit, delete. */
function rightsPermissionsFromString(s, legacyFlag, flagName) {
  const str = String(s || '');
  const ch = (i) => (str.length > i ? str.charAt(i) : '');
  const bit = (i) => ch(i) === '1';
  if (!str) {
    return { canOpen: true, canAdd: true, canEdit: true, canDelete: true, flags: legacyFlag };
  }
  return {
    canOpen: bit(0),
    canAdd: bit(1),
    canEdit: bit(2),
    canDelete: bit(3),
    flags: flagName,
  };
}

function isLoginOptionalTableError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('ORA-00942') ||
    msg.includes('ORA-00904') ||
    /table or view does not exist/i.test(msg) ||
    /invalid identifier/i.test(msg)
  );
}

function isEffectiveCompUid(comp_uid) {
  const s = String(comp_uid ?? '').trim();
  return s.length > 0 && s !== '0';
}

function resolveUserName(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const q = req?.query && typeof req.query === 'object' ? req.query : {};
  return String(b.user_name ?? b.USER_NAME ?? q.user_name ?? q.USER_NAME ?? req?.user?.name ?? '').trim();
}

function createPurchaseOrder({ runQuery, parseDateOnly, withCompTransaction, runHubQuery }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createPurchaseOrder requires runQuery and parseDateOnly');
  }
  const queryHub = typeof runHubQuery === 'function' ? runHubQuery : runQuery;

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

  /** Oracle date bind as DD-MM-YYYY string (matches voucherEntry / ledgerReports). */
  function formatDateBind(raw) {
    const d = parseDateOnly(raw);
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  async function fetchPorderUserF9String(user_name) {
    const u = String(user_name || '').trim().toUpperCase();
    if (!u) return { f9: '', source: 'empty_user' };
    // VFP usertst.prg: G_MAIN_DATABASE.USERS → GRAINFAS.USERS (not DAL.USERS / year schema).
    const tables = ['GRAINFAS.USERS', 'USERS'];
    for (const t of tables) {
      try {
        const rows = await queryHub(
          `SELECT F9 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
          { u },
          { suppressDbErrorLog: true }
        );
        if (rows?.length) {
          const raw = rows[0].F9 ?? rows[0].f9;
          return { f9: raw != null ? String(raw).trim() : '', source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* ignore optional schema/table */
        }
      }
    }
    return { f9: '', source: 'none' };
  }

  function porderPermissionsFromF9(f9) {
    const str = String(f9 ?? '').trim();
    // VFP usertst.prg: SUBS(F9,n,1)<>'1' denies — empty/missing F9 must not grant rights.
    const padded = (str || '0000').padEnd(4, '0').slice(0, 4);
    const bit = (i) => padded.charAt(i) === '1';
    return {
      canOpen: bit(0),
      canAdd: bit(1),
      canEdit: bit(2),
      canDelete: bit(3),
      flags: 'f9',
    };
  }

  async function fetchPorderUserPermissions(user_name) {
    const { f9, source } = await fetchPorderUserF9String(user_name);
    return { f9, source, ...porderPermissionsFromF9(f9) };
  }

  async function assertPorderPermission(user_name, comp_uid, kind) {
    const perms = await fetchPorderUserPermissions(user_name);
    if (!perms.canOpen) {
      const err = new Error('Access Denied');
      err.status = 403;
      throw err;
    }
    if (kind === 'add' && !perms.canAdd) {
      const err = new Error('You Can Not Add');
      err.status = 403;
      throw err;
    }
    if (kind === 'edit' && !perms.canEdit) {
      const err = new Error('You Can Not Edit');
      err.status = 403;
      throw err;
    }
    if (kind === 'delete' && !perms.canDelete) {
      const err = new Error('You Can Not Delete');
      err.status = 403;
      throw err;
    }
    return perms;
  }

  async function fetchPorderQw(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT PORDER_Q_W FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const v = String(rows?.[0]?.PORDER_Q_W ?? rows?.[0]?.porder_q_w ?? 'W')
        .trim()
        .toUpperCase();
      return v === 'Q' ? 'Q' : 'W';
    } catch {
      return 'W';
    }
  }

  const pendingApi = createPurchaseOrderPending({
    runQuery,
    parseDateOnly,
    PO_TYPE,
    normCode,
    normStatus,
    num,
    formatDateOut,
    fetchPorderQw,
  });

  async function assertMasterCode(comp_code, code, comp_uid, label) {
    const cc = Number(comp_code) || 0;
    const c = normCode(code);
    if (!c) return null;
    const rows = await runQuery(
      `SELECT CODE, NAME FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = TRIM(:code)`,
      { comp_code: cc, code: c },
      comp_uid
    );
    const row = rows?.[0];
    if (!row) {
      const err = new Error(`${label || 'Account'} "${c}" not found in master.`);
      err.status = 400;
      throw err;
    }
    return {
      code: normCode(row.CODE ?? row.code),
      name: String(row.NAME ?? row.name ?? '').trim(),
    };
  }

  async function assertItemCode(comp_code, item_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const ic = Number(item_code) || 0;
    if (!ic) {
      const err = new Error('Item code is required on each line.');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(
      `SELECT ITEM_CODE, ITEM_NAME FROM ITEMMAST WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code`,
      { comp_code: cc, item_code: ic },
      comp_uid
    );
    const row = rows?.[0];
    if (!row) {
      const err = new Error(`Item ${ic} not found in item master.`);
      err.status = 400;
      throw err;
    }
    return {
      item_code: ic,
      item_name: String(row.ITEM_NAME ?? row.item_name ?? '').trim(),
    };
  }

  async function fetchNextSoNo(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT NVL(MAX(SO_NO), 0) + 1 AS NEXT_NO FROM PORDER WHERE COMP_CODE = :comp_code AND TYPE = :type`,
      { comp_code: cc, type: PO_TYPE },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  async function loadPurchaseOrder(comp_code, comp_uid, so_no, so_date) {
    const cc = Number(comp_code) || 0;
    const no = Number(so_no) || 0;
    if (!no) {
      const err = new Error('SO number is required.');
      err.status = 400;
      throw err;
    }
    const sdt = so_date ? parseDateOnly(so_date) : null;
    const binds = { comp_code: cc, type: PO_TYPE, so_no: no };
    let dateClause = '';
    if (sdt) {
      binds.so_date = formatDateBind(sdt);
      dateClause = " AND TRUNC(A.SO_DATE) = TRUNC(TO_DATE(:so_date, 'DD-MM-YYYY'))";
    }
    const sql = `
      SELECT
        A.*,
        B.ITEM_NAME,
        C.NAME AS PARTY_NAME,
        D.NAME AS BK_NAME,
        E.NAME AS SUP_NAME,
        G.GOD_NAME
      FROM PORDER A
      LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.SUP_CODE = E.CODE
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) AND A.SO_NO = :so_no${dateClause}
      ORDER BY A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    if (!rows?.length) {
      const err = new Error('Purchase order not found.');
      err.status = 404;
      throw err;
    }
    const h = rows[0];
    const header = {
      type: PO_TYPE,
      so_no: Number(h.SO_NO ?? h.so_no ?? 0) || no,
      so_date: formatDateOut(h.SO_DATE ?? h.so_date),
      delv_date: formatDateOut(h.DELV_DATE ?? h.delv_date),
      code: normCode(h.CODE ?? h.code),
      party_name: String(h.PARTY_NAME ?? h.party_name ?? '').trim(),
      bk_code: normCode(h.BK_CODE ?? h.bk_code),
      bk_name: String(h.BK_NAME ?? h.bk_name ?? '').trim(),
      sup_code: normCode(h.SUP_CODE ?? h.sup_code),
      sup_name: String(h.SUP_NAME ?? h.sup_name ?? '').trim(),
      loc_code: normCode(h.LOC_CODE ?? h.loc_code),
      god_code: normCode(h.GOD_CODE ?? h.god_code),
      god_name: String(h.GOD_NAME ?? h.god_name ?? '').trim(),
      po_no: String(h.PO_NO ?? h.po_no ?? '').trim(),
      clear_yn: String(h.CLEAR_YN ?? h.clear_yn ?? 'N').trim().toUpperCase() || 'N',
      p_condition: String(h.P_CONDITION ?? h.p_condition ?? '').trim(),
      delv_mth: String(h.DELV_MTH ?? h.delv_mth ?? '').trim(),
      remarks: String(h.REMARKS ?? h.remarks ?? '').trim(),
      remarks2: String(h.REMARKS2 ?? h.remarks2 ?? '').trim(),
      remarks3: String(h.REMARKS3 ?? h.remarks3 ?? '').trim(),
      pmt_due_days: Number(h.PMT_DUE_DAYS ?? h.pmt_due_days ?? 0) || 0,
      vr_date: formatDateOut(h.VR_DATE ?? h.vr_date),
      vr_no: Number(h.VR_NO ?? h.vr_no ?? 0) || 0,
      vr_type: String(h.VR_TYPE ?? h.vr_type ?? '').trim(),
      vr_type_type: String(h.VR_TYPE_TYPE ?? h.vr_type_type ?? '').trim(),
      dr_amt: num(h.DR_AMT ?? h.dr_amt),
    };
    const lines = rows.map((r, idx) => ({
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      amt_cal: String(r.AMT_CAL ?? r.amt_cal ?? 'W').trim().toUpperCase() || 'W',
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
    }));
    return { ok: true, header, lines };
  }

  async function listPurchaseOrders(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc, type: PO_TYPE };
    let where = 'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type)';
    if (opts.sdt) {
      const sdt = formatDateBind(opts.sdt);
      if (sdt) {
        binds.sdt = sdt;
        where += " AND TRUNC(A.SO_DATE) >= TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY'))";
      }
    }
    if (opts.edt) {
      const edt = formatDateBind(opts.edt);
      if (edt) {
        binds.edt = edt;
        where += " AND TRUNC(A.SO_DATE) <= TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))";
      }
    }
    const poFilter = String(opts.po_no ?? '').trim();
    if (poFilter) {
      binds.po_no = `%${poFilter.toUpperCase()}%`;
      where += " AND UPPER(TRIM(NVL(A.PO_NO, ' '))) LIKE :po_no";
    }
    const partyFilter = String(opts.party ?? '').trim();
    if (partyFilter) {
      binds.party_q = `%${partyFilter.toUpperCase()}%`;
      where += ' AND (UPPER(TRIM(A.CODE)) LIKE :party_q OR UPPER(TRIM(B.NAME)) LIKE :party_q)';
    }
    const sql = `
      SELECT SO_NO, SO_DATE, CODE, PARTY_NAME, PO_NO, LINE_COUNT, TOT_AMT FROM (
        SELECT TRUNC(A.SO_DATE) AS SO_DATE, A.SO_NO, A.CODE, B.NAME AS PARTY_NAME,
               MAX(A.PO_NO) AS PO_NO, COUNT(*) AS LINE_COUNT, SUM(NVL(A.AMOUNT, 0)) AS TOT_AMT
        FROM PORDER A
        JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE ${where}
        GROUP BY TRUNC(A.SO_DATE), A.SO_NO, A.CODE, B.NAME
        ORDER BY TRUNC(A.SO_DATE), A.SO_NO
      ) WHERE ROWNUM <= 1000
      ORDER BY SO_DATE, SO_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r) => ({
      so_no: Number(r.SO_NO ?? r.so_no ?? 0) || 0,
      so_date: formatDateOut(r.SO_DATE ?? r.so_date),
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
      line_count: Number(r.LINE_COUNT ?? r.line_count ?? 0) || 0,
      tot_amt: num(r.TOT_AMT ?? r.tot_amt),
    }));
  }

  async function findPurchaseOrderByPoNo(comp_code, comp_uid, po_no) {
    const cc = Number(comp_code) || 0;
    const pono = String(po_no ?? '').trim();
    if (!pono) {
      const err = new Error('P.O.No. is required.');
      err.status = 400;
      throw err;
    }
    const sql = `
      SELECT SO_NO, SO_DATE FROM (
        SELECT A.SO_NO, TRUNC(MIN(A.SO_DATE)) AS SO_DATE
        FROM PORDER A
        WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type)
          AND UPPER(TRIM(NVL(A.PO_NO, ' '))) = UPPER(TRIM(:po_no))
        GROUP BY A.SO_NO, TRUNC(A.SO_DATE)
        ORDER BY MIN(A.SO_DATE) DESC, A.SO_NO DESC
      ) WHERE ROWNUM = 1`;
    const rows = await runQuery(sql, { comp_code: cc, type: PO_TYPE, po_no: pono }, comp_uid);
    const hit = rows?.[0];
    if (!hit) {
      const err = new Error(`P.O.No. "${pono}" not found.`);
      err.status = 404;
      throw err;
    }
    const so_no = Number(hit.SO_NO ?? hit.so_no ?? 0) || 0;
    const so_date = formatDateOut(hit.SO_DATE ?? hit.so_date);
    return loadPurchaseOrder(cc, comp_uid, so_no, so_date);
  }

  async function fetchPurchaseOrderChecklist(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = {
      comp_code: cc,
      type: PO_TYPE,
      sdt: formatDateBind(opts.sdt) || formatDateBind(new Date()),
      edt: formatDateBind(opts.edt) || formatDateBind(new Date()),
      sbno: Math.max(1, Number(opts.sbno) || 1),
      ebno: Math.max(1, Number(opts.ebno) || 999999),
    };
    let where =
      "A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) " +
      "AND TRUNC(A.SO_DATE) BETWEEN TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:edt, 'DD-MM-YYYY')) " +
      'AND A.SO_NO BETWEEN :sbno AND :ebno';

    const partyCode = normCode(opts.code);
    if (partyCode) {
      binds.code = partyCode;
      where += ' AND TRIM(A.CODE) = TRIM(:code)';
    }
    const brokerCode = normCode(opts.bk_code);
    if (brokerCode) {
      binds.bk_code = brokerCode;
      where += ' AND TRIM(NVL(A.BK_CODE, :bk_code)) = TRIM(:bk_code)';
    }
    const supCode = normCode(opts.sup_code);
    if (supCode) {
      binds.sup_code = supCode;
      where += ' AND TRIM(NVL(A.SUP_CODE, :sup_code)) = TRIM(:sup_code)';
    }
    const godCode = normCode(opts.god_code);
    if (godCode) {
      binds.god_code = godCode;
      where += ' AND TRIM(NVL(A.GOD_CODE, :god_code)) = TRIM(:god_code)';
    }
    const locCode = normCode(opts.loc_code);
    if (locCode) {
      binds.loc_code = locCode;
      where += ' AND TRIM(NVL(A.LOC_CODE, :loc_code)) = TRIM(:loc_code)';
    }
    const itemCode = Number(opts.item_code) || 0;
    if (itemCode) {
      binds.item_code = itemCode;
      where += ' AND A.ITEM_CODE = :item_code';
    }

    const sql = `
      SELECT
        TRUNC(A.SO_DATE) AS SO_DATE,
        A.SO_NO,
        TRUNC(A.DELV_DATE) AS DELV_DATE,
        TRIM(A.CODE) AS CODE,
        C.NAME AS PARTY_NAME,
        NVL(C.CITY, ' ') AS CITY,
        TRIM(NVL(A.BK_CODE, ' ')) AS BK_CODE,
        NVL(D.NAME, ' ') AS BK_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        B.ITEM_NAME,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        NVL(A.QNTY, 0) AS QNTY,
        CASE WHEN TRIM(NVL(A.STATUS, 'B')) = 'B' THEN NVL(A.QNTY, 0) ELSE 0 END AS BAGS,
        CASE WHEN TRIM(NVL(A.STATUS, 'B')) <> 'B' THEN NVL(A.QNTY, 0) ELSE 0 END AS KATTA,
        NVL(A.WEIGHT, 0) AS WEIGHT,
        NVL(A.RATE, 0) AS RATE,
        NVL(A.AMOUNT, 0) AS AMOUNT,
        NVL(A.PO_NO, ' ') AS PO_NO,
        NVL(A.P_CONDITION, ' ') AS P_CONDITION,
        NVL(A.DELV_MTH, ' ') AS DELV_MTH,
        NVL(A.REMARKS, ' ') AS REMARKS,
        NVL(A.REMARKS2, ' ') AS REMARKS2,
        NVL(A.REMARKS3, ' ') AS REMARKS3,
        NVL(A.CLEAR_YN, ' ') AS CLEAR_YN,
        TRIM(NVL(A.GOD_CODE, ' ')) AS GOD_CODE,
        TRIM(NVL(A.SUP_CODE, ' ')) AS SUP_CODE,
        NVL(E.NAME, ' ') AS SUP_NAME,
        TRIM(NVL(A.LOC_CODE, ' ')) AS LOC_CODE,
        TRUNC(A.VR_DATE) AS VR_DATE,
        NVL(A.VR_NO, 0) AS VR_NO,
        NVL(A.VR_TYPE, ' ') AS VR_TYPE,
        NVL(A.VR_TYPE_TYPE, ' ') AS VR_TYPE_TYPE,
        NVL(A.DR_AMT, 0) AS DR_AMT
      FROM PORDER A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.SUP_CODE = E.CODE
      WHERE ${where}
      ORDER BY A.SO_DATE, A.SO_NO, A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r) => ({
      so_no: Number(r.SO_NO ?? r.so_no ?? 0) || 0,
      so_date: formatDateOut(r.SO_DATE ?? r.so_date),
      delv_date: formatDateOut(r.DELV_DATE ?? r.delv_date),
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      city: String(r.CITY ?? r.city ?? '').trim(),
      bk_code: normCode(r.BK_CODE ?? r.bk_code),
      bk_name: String(r.BK_NAME ?? r.bk_name ?? '').trim(),
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      qnty: num(r.QNTY ?? r.qnty),
      bags: num(r.BAGS ?? r.bags),
      katta: num(r.KATTA ?? r.katta),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
      p_condition: String(r.P_CONDITION ?? r.p_condition ?? '').trim(),
      delv_mth: String(r.DELV_MTH ?? r.delv_mth ?? '').trim(),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      remarks2: String(r.REMARKS2 ?? r.remarks2 ?? '').trim(),
      remarks3: String(r.REMARKS3 ?? r.remarks3 ?? '').trim(),
      clear_yn: String(r.CLEAR_YN ?? r.clear_yn ?? '').trim(),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      sup_code: normCode(r.SUP_CODE ?? r.sup_code),
      sup_name: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
      loc_code: normCode(r.LOC_CODE ?? r.loc_code),
      vr_date: formatDateOut(r.VR_DATE ?? r.vr_date),
      vr_no: Number(r.VR_NO ?? r.vr_no ?? 0) || 0,
      vr_type: String(r.VR_TYPE ?? r.vr_type ?? '').trim(),
      vr_type_type: String(r.VR_TYPE_TYPE ?? r.vr_type_type ?? '').trim(),
      dr_amt: num(r.DR_AMT ?? r.dr_amt),
    }));
  }

  function poStatusUnit(status) {
    const s = normStatus(status);
    if (s === 'B') return 'BAGS';
    if (s === 'K') return 'KATTA';
    if (s === 'H') return 'HKATTA';
    return '';
  }

  async function fetchPurchaseOrdersForPrint(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const sbno = Math.max(1, Number(opts.sbno) || 1);
    const ebno = Math.max(sbno, Number(opts.ebno) || sbno);
    const showPmtDue = String(opts.pmt_due_yn ?? opts.pmt_due_date ?? 'Y').trim().toUpperCase() !== 'N';
    const sql = `
      SELECT
        TRUNC(A.SO_DATE) AS SO_DATE,
        A.SO_NO,
        TRUNC(A.DELV_DATE) AS DELV_DATE,
        TRIM(A.CODE) AS CODE,
        C.NAME AS PARTY_NAME,
        NVL(C.ADD1, ' ') AS ADD1,
        NVL(C.ADD2, ' ') AS ADD2,
        NVL(C.ADD3, ' ') AS ADD3,
        NVL(C.CITY, ' ') AS CITY,
        NVL(C.TEL_NO_O, ' ') AS TEL_NO_O,
        NVL(C.TIN, ' ') AS TIN,
        NVL(C.GST_NO, ' ') AS GST_NO,
        TRIM(NVL(A.BK_CODE, ' ')) AS BK_CODE,
        NVL(D.NAME, ' ') AS BK_NAME,
        A.TRN_NO,
        A.ITEM_CODE,
        B.ITEM_NAME,
        NVL(B.ITEM_HEAD, NVL(B.HSN_CODE, ' ')) AS HSN_CODE,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        NVL(A.QNTY, 0) AS QNTY,
        NVL(A.WEIGHT, 0) AS WEIGHT,
        NVL(A.RATE, 0) AS RATE,
        NVL(A.AMOUNT, 0) AS AMOUNT,
        NVL(A.PO_NO, ' ') AS PO_NO,
        NVL(A.P_CONDITION, ' ') AS P_CONDITION,
        NVL(A.DELV_MTH, ' ') AS DELV_MTH,
        NVL(A.REMARKS, ' ') AS REMARKS,
        NVL(A.REMARKS2, ' ') AS REMARKS2,
        NVL(A.REMARKS3, ' ') AS REMARKS3,
        NVL(A.PMT_DUE_DAYS, 0) AS PMT_DUE_DAYS,
        TRUNC(A.SO_DATE) + NVL(A.PMT_DUE_DAYS, 0) AS PMT_DUE_DATE
      FROM PORDER A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND A.SO_NO BETWEEN :sbno AND :ebno
      ORDER BY A.SO_DATE, A.SO_NO, A.TRN_NO`;
    const rows = await runQuery(sql, { comp_code: cc, type: PO_TYPE, sbno, ebno }, comp_uid);
    const grouped = new Map();
    for (const r of rows || []) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      const soDate = formatDateOut(r.SO_DATE ?? r.so_date);
      const key = `${soNo}|${soDate}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          header: {
            so_no: soNo,
            so_date: soDate,
            delv_date: formatDateOut(r.DELV_DATE ?? r.delv_date),
            pmt_due_days: Number(r.PMT_DUE_DAYS ?? r.pmt_due_days ?? 0) || 0,
            pmt_due_date: formatDateOut(r.PMT_DUE_DATE ?? r.pmt_due_date),
            show_pmt_due: showPmtDue,
            code: normCode(r.CODE ?? r.code),
            party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
            add1: String(r.ADD1 ?? r.add1 ?? '').trim(),
            add2: String(r.ADD2 ?? r.add2 ?? '').trim(),
            add3: String(r.ADD3 ?? r.add3 ?? '').trim(),
            city: String(r.CITY ?? r.city ?? '').trim(),
            tel_no: String(r.TEL_NO_O ?? r.tel_no_o ?? '').trim(),
            tin: String(r.TIN ?? r.tin ?? '').trim(),
            gst_no: String(r.GST_NO ?? r.gst_no ?? '').trim(),
            bk_code: normCode(r.BK_CODE ?? r.bk_code),
            bk_name: String(r.BK_NAME ?? r.bk_name ?? '').trim(),
            po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
            p_condition: String(r.P_CONDITION ?? r.p_condition ?? '').trim(),
            delv_mth: String(r.DELV_MTH ?? r.delv_mth ?? '').trim(),
            remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
            remarks2: String(r.REMARKS2 ?? r.remarks2 ?? '').trim(),
            remarks3: String(r.REMARKS3 ?? r.remarks3 ?? '').trim(),
          },
          lines: [],
          totals: { qnty: 0, weight: 0, amount: 0 },
        });
      }
      const order = grouped.get(key);
      const qnty = num(r.QNTY ?? r.qnty);
      const weight = num(r.WEIGHT ?? r.weight);
      const amount = num(r.AMOUNT ?? r.amount);
      const status = normStatus(r.STATUS ?? r.status);
      order.lines.push({
        trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        hsn_code: String(r.HSN_CODE ?? r.hsn_code ?? '').trim(),
        status,
        status_unit: poStatusUnit(status),
        qnty,
        weight,
        rate: num(r.RATE ?? r.rate),
        amount,
      });
      order.totals.qnty += qnty;
      order.totals.weight += weight;
      order.totals.amount += amount;
    }
    return {
      show_pmt_due: showPmtDue,
      orders: Array.from(grouped.values()),
    };
  }

  function normalizeLine(ln, idx, defaultQw) {
    const item_code = Number(ln.item_code ?? ln.ITEM_CODE ?? 0) || 0;
    const line = {
      trn_no: Number(ln.trn_no ?? ln.TRN_NO ?? idx + 1) || idx + 1,
      item_code,
      status: normStatus(ln.status ?? ln.STATUS),
      qnty: num(ln.qnty ?? ln.QNTY),
      weight: num(ln.weight ?? ln.WEIGHT),
      amt_cal: String(ln.amt_cal ?? ln.AMT_CAL ?? defaultQw).trim().toUpperCase() || defaultQw,
      rate: num(ln.rate ?? ln.RATE),
      amount: num(ln.amount ?? ln.AMOUNT),
    };
    line.amount = calcLineAmount(line, defaultQw);
    return line;
  }

  async function savePurchaseOrder(comp_code, comp_year, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    const mode = String(body.mode ?? 'new').trim().toLowerCase();
    await assertPorderPermission(user_name, comp_uid, mode === 'edit' ? 'edit' : 'add');

    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    const sdt = parseDateOnly(body.so_date ?? body.SO_DATE);
    if (!sdt) {
      const err = new Error('SO date is required.');
      err.status = 400;
      throw err;
    }
    const party = normCode(body.code ?? body.CODE);
    if (!party) {
      const err = new Error('Party (supplier) code is required.');
      err.status = 400;
      throw err;
    }
    await assertMasterCode(cc, party, comp_uid, 'Party');
    const bk = normCode(body.bk_code ?? body.BK_CODE);
    const sup = normCode(body.sup_code ?? body.SUP_CODE);
    if (bk) await assertMasterCode(cc, bk, comp_uid, 'Broker');
    if (sup) await assertMasterCode(cc, sup, comp_uid, 'Supplier');

    const defaultQw = await fetchPorderQw(cc, comp_uid);
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn
      .map((ln, idx) => normalizeLine(ln, idx, defaultQw))
      .filter((ln) => ln.item_code);
    if (!lines.length) {
      const err = new Error('Enter at least one item line.');
      err.status = 400;
      throw err;
    }
    for (const ln of lines) {
      await assertItemCode(cc, ln.item_code, comp_uid);
    }

    let so_no = Number(body.so_no ?? body.SO_NO ?? 0) || 0;
    if (mode === 'new' || !so_no) {
      so_no = await fetchNextSoNo(cc, comp_uid);
    }

    const header = {
      so_no,
      so_date: sdt,
      delv_date: parseDateOnly(body.delv_date ?? body.DELV_DATE),
      code: party,
      bk_code: bk,
      sup_code: sup,
      loc_code: normCode(body.loc_code ?? body.LOC_CODE),
      god_code: normCode(body.god_code ?? body.GOD_CODE),
      po_no: String(body.po_no ?? body.PO_NO ?? '').trim().slice(0, 50),
      clear_yn: String(body.clear_yn ?? body.CLEAR_YN ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
      p_condition: String(body.p_condition ?? body.P_CONDITION ?? '').trim().slice(0, 50),
      delv_mth: String(body.delv_mth ?? body.DELV_MTH ?? '').trim().slice(0, 50),
      remarks: String(body.remarks ?? body.REMARKS ?? '').trim().slice(0, 150),
      remarks2: String(body.remarks2 ?? body.REMARKS2 ?? '').trim().slice(0, 150),
      remarks3: String(body.remarks3 ?? body.REMARKS3 ?? '').trim().slice(0, 150),
      pmt_due_days: Number(body.pmt_due_days ?? body.PMT_DUE_DAYS ?? 0) || 0,
      vr_date: parseDateOnly(body.vr_date ?? body.VR_DATE),
      vr_no: Number(body.vr_no ?? body.VR_NO ?? 0) || 0,
      vr_type: String(body.vr_type ?? body.VR_TYPE ?? '').trim().slice(0, 2),
      vr_type_type: String(body.vr_type_type ?? body.VR_TYPE_TYPE ?? '').trim().slice(0, 1),
      dr_amt: num(body.dr_amt ?? body.DR_AMT),
    };

    const user = String(body.user_name ?? body.USER_NAME ?? req?.user?.name ?? 'WEB').trim().slice(0, 10);
    const entDate = new Date();

    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await q(
        `DELETE FROM PORDER WHERE COMP_CODE = :comp_code AND TYPE = :type AND SO_NO = :so_no`,
        { comp_code: cc, type: PO_TYPE, so_no }
      );
      const ins = `
        INSERT INTO PORDER (
          COMP_YEAR, COMP_CODE, TYPE, SO_NO, SO_DATE, CODE, PO_NO, TRN_NO, ITEM_CODE,
          QNTY, WEIGHT, RATE, AMOUNT, REMARKS, USER_NAME, ENT_DATE, STATUS,
          DELV_DATE, BK_CODE, P_CONDITION, DELV_MTH, AMT_CAL, REMARKS2, REMARKS3,
          CLEAR_YN, PMT_DUE_DAYS, GOD_CODE, SUP_CODE, LOC_CODE,
          VR_DATE, VR_NO, VR_TYPE, VR_TYPE_TYPE, DR_AMT
        ) VALUES (
          :comp_year, :comp_code, :type, :so_no, :so_date, :code, :po_no, :trn_no, :item_code,
          :qnty, :weight, :rate, :amount, :remarks, :user_name, :ent_date, :status,
          :delv_date, :bk_code, :p_condition, :delv_mth, :amt_cal, :remarks2, :remarks3,
          :clear_yn, :pmt_due_days, :god_code, :sup_code, :loc_code,
          :vr_date, :vr_no, :vr_type, :vr_type_type, :dr_amt
        )`;
      for (const ln of lines) {
        await q(ins, {
          comp_year: cy,
          comp_code: cc,
          type: PO_TYPE,
          so_no,
          so_date: header.so_date,
          code: header.code,
          po_no: header.po_no,
          trn_no: ln.trn_no,
          item_code: ln.item_code,
          qnty: ln.qnty,
          weight: ln.weight,
          rate: ln.rate,
          amount: ln.amount,
          remarks: header.remarks,
          user_name: user,
          ent_date: entDate,
          status: ln.status,
          delv_date: header.delv_date,
          bk_code: header.bk_code,
          p_condition: header.p_condition,
          delv_mth: header.delv_mth,
          amt_cal: ln.amt_cal,
          remarks2: header.remarks2,
          remarks3: header.remarks3,
          clear_yn: header.clear_yn,
          pmt_due_days: header.pmt_due_days,
          god_code: header.god_code,
          sup_code: header.sup_code,
          loc_code: header.loc_code,
          vr_date: header.vr_date,
          vr_no: header.vr_no,
          vr_type: header.vr_type,
          vr_type_type: header.vr_type_type,
          dr_amt: header.dr_amt,
        });
      }
    });

    return { ok: true, so_no, so_date: formatDateOut(sdt), message: 'Purchase order saved.' };
  }

  async function deletePurchaseOrder(comp_code, comp_uid, so_no, so_date, user_name) {
    await assertPorderPermission(user_name, comp_uid, 'delete');
    const cc = Number(comp_code) || 0;
    const no = Number(so_no) || 0;
    if (!no) {
      const err = new Error('SO number is required.');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, type: PO_TYPE, so_no: no };
    let sql = `DELETE FROM PORDER WHERE COMP_CODE = :comp_code AND TYPE = :type AND SO_NO = :so_no`;
    const soDateBind = formatDateBind(so_date);
    if (soDateBind) {
      binds.so_date = soDateBind;
      sql += " AND TRUNC(SO_DATE) = TRUNC(TO_DATE(:so_date, 'DD-MM-YYYY'))";
    }
    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      const existing = await loadPurchaseOrder(cc, comp_uid, no, so_date).catch(() => null);
      if (!existing) {
        const err = new Error('Purchase order not found.');
        err.status = 404;
        throw err;
      }
      await q(sql, binds);
    });
    return { ok: true, message: 'Purchase order deleted.' };
  }

  function registerRoutes(app) {
    app.get('/api/purchase-order/user-permissions', async (req, res) => {
      try {
        const { comp_uid, user_name } = req.query;
        if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
          return res.status(400).json({ error: 'comp_uid and user_name are required' });
        }
        const data = await fetchPorderUserPermissions(String(user_name));
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/context', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertPorderPermission(user_name, comp_uid, 'access');
        const porder_q_w = await fetchPorderQw(comp_code, comp_uid);
        res.json({ ok: true, type: PO_TYPE, porder_q_w });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertPorderPermission(user_name, comp_uid, 'access');
        const so_no = await fetchNextSoNo(comp_code, comp_uid);
        res.json({ ok: true, so_no, type: PO_TYPE });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sdt, edt, so_date, po_no, party } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const rows = await listPurchaseOrders(comp_code, comp_uid, {
          sdt: sdt || so_date,
          edt,
          po_no,
          party,
        });
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order/list error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/checklist', async (req, res) => {
      try {
        const {
          comp_code,
          comp_uid,
          user_name,
          sdt,
          edt,
          sbno,
          ebno,
          code,
          bk_code,
          sup_code,
          item_code,
          loc_code,
          god_code,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const rows = await fetchPurchaseOrderChecklist(comp_code, comp_uid, {
          sdt,
          edt,
          sbno,
          ebno,
          code,
          bk_code,
          sup_code,
          item_code,
          loc_code,
          god_code,
        });
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order/checklist error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/pending-summary', async (req, res) => {
      try {
        const {
          comp_code,
          comp_uid,
          user_name,
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          sup_code,
          god_code,
          loc_code,
          so_no,
          qnty_ignore,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const data = await pendingApi.fetchPendingSummary(comp_code, comp_uid, {
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          sup_code,
          god_code,
          loc_code,
          so_no,
          qnty_ignore,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order/pending-summary error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/pending-detail', async (req, res) => {
      try {
        const {
          comp_code,
          comp_uid,
          user_name,
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          sup_code,
          god_code,
          loc_code,
          so_no,
          qnty_ignore,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const data = await pendingApi.fetchPendingDetail(comp_code, comp_uid, {
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          sup_code,
          god_code,
          loc_code,
          so_no,
          qnty_ignore,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order/pending-detail error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/print-batch', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sbno, ebno, pmt_due_yn, pmt_due_date } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const data = await fetchPurchaseOrdersForPrint(comp_code, comp_uid, {
          sbno,
          ebno,
          pmt_due_yn: pmt_due_yn ?? pmt_due_date,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order/print-batch error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order/by-po-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, po_no } = req.query;
        if (!comp_code || !po_no) {
          return res.status(400).json({ error: 'comp_code and po_no are required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const data = await findPurchaseOrderByPoNo(comp_code, comp_uid, po_no);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order/by-po-no error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/purchase-order', async (req, res) => {
      try {
        const { comp_code, comp_uid, so_no, so_date, user_name } = req.query;
        if (!comp_code || !so_no) {
          return res.status(400).json({ error: 'comp_code and so_no are required' });
        }
        await assertPorderPermission(user_name, comp_uid, 'access');
        const data = await loadPurchaseOrder(comp_code, comp_uid, so_no, so_date);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order GET error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.post('/api/purchase-order', async (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = body.comp_code ?? body.COMP_CODE;
        const comp_year = body.comp_year ?? body.COMP_YEAR ?? 0;
        const comp_uid = body.comp_uid ?? body.COMP_UID;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const result = await savePurchaseOrder(comp_code, comp_year, comp_uid, body, req);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order POST error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.delete('/api/purchase-order', async (req, res) => {
      try {
        const q = req.query || {};
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = q.comp_code ?? body.comp_code;
        const comp_uid = q.comp_uid ?? body.comp_uid;
        const so_no = q.so_no ?? body.so_no;
        const so_date = q.so_date ?? body.so_date;
        const user_name = resolveUserName(body, req);
        if (!comp_code || !so_no) {
          return res.status(400).json({ error: 'comp_code and so_no are required' });
        }
        const result = await deletePurchaseOrder(comp_code, comp_uid, so_no, so_date, user_name);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ purchase-order DELETE error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });
  }

  return { registerRoutes, loadPurchaseOrder, savePurchaseOrder, deletePurchaseOrder, fetchNextSoNo, fetchPurchaseOrderChecklist };
}

module.exports = { createPurchaseOrder, PO_TYPE };
