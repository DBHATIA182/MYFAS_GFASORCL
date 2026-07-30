/**
 * Sales Order entry — VFP DO FORM SORDER WITH 'SO' → SORDER.TYPE = 'SO'.
 * Rights: USERS.F10 (access/add/edit/delete).
 */

'use strict';

const { createSalesOrderPending } = require('./salesOrderPending.cjs');

const SO_TYPE = 'SO';

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

function normDE(v) {
  const s = String(v ?? 'D').trim().toUpperCase();
  return s === 'E' ? 'E' : 'D';
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

function calcLineRate(line) {
  const usd = num(line.usd_rate ?? line.USD_RATE);
  const conv = num(line.conv_rate ?? line.CONV_RATE);
  if (usd > 0 && conv > 0) return Math.round(usd * conv * 100) / 100;
  return num(line.rate ?? line.RATE);
}

/**
 * VFP SORDER AfterRowColChange:
 * AMT_CAL='Q' → ROUND(QNTY*RATE,2)
 * else if G_WGTKQ='Q' → ROUND(WEIGHT*RATE,2)
 * else (K) → ROUND(WEIGHT*RATE/100,2)
 */
function calcLineAmount(line, defaultQw = 'W', wgtKq = 'K') {
  const rate = calcLineRate(line);
  const mode = String(line.amt_cal ?? line.AMT_CAL ?? defaultQw).trim().toUpperCase() || defaultQw;
  if (mode === 'Q') {
    return Math.round(num(line.qnty ?? line.QNTY) * rate * 100) / 100;
  }
  const weight = num(line.weight ?? line.WEIGHT);
  const kq = String(wgtKq || 'K').trim().toUpperCase();
  if (kq === 'Q') {
    return Math.round(weight * rate * 100) / 100;
  }
  return Math.round(((weight * rate) / 100) * 100) / 100;
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

function resolveUserName(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const q = req?.query && typeof req.query === 'object' ? req.query : {};
  return String(b.user_name ?? b.USER_NAME ?? q.user_name ?? q.USER_NAME ?? req?.user?.name ?? '').trim();
}

function createSalesOrder({ runQuery, parseDateOnly, withCompTransaction, runHubQuery }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createSalesOrder requires runQuery and parseDateOnly');
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

  function formatDateBind(raw) {
    const d = parseDateOnly(raw);
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  async function fetchSorderUserF10String(user_name) {
    const u = String(user_name || '').trim().toUpperCase();
    if (!u) return { f10: '', source: 'empty_user' };
    const tables = ['GRAINFAS.USERS', 'USERS'];
    for (const t of tables) {
      try {
        const rows = await queryHub(
          `SELECT F10 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
          { u },
          { suppressDbErrorLog: true }
        );
        if (rows?.length) {
          const raw = rows[0].F10 ?? rows[0].f10;
          return { f10: raw != null ? String(raw).trim() : '', source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* ignore optional schema/table */
        }
      }
    }
    return { f10: '', source: 'none' };
  }

  function sorderPermissionsFromF10(f10) {
    const str = String(f10 ?? '').trim();
    const padded = (str || '0000').padEnd(4, '0').slice(0, 4);
    const bit = (i) => padded.charAt(i) === '1';
    return {
      canOpen: bit(0),
      canAdd: bit(1),
      canEdit: bit(2),
      canDelete: bit(3),
      flags: 'f10',
    };
  }

  async function fetchSorderUserPermissions(user_name) {
    const { f10, source } = await fetchSorderUserF10String(user_name);
    return { f10, source, ...sorderPermissionsFromF10(f10) };
  }

  async function assertSorderPermission(user_name, comp_uid, kind) {
    const perms = await fetchSorderUserPermissions(user_name);
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

  async function fetchSorderQw(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(PORDER_Q_W, 'W') AS ORDER_QW FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const v = String(rows?.[0]?.ORDER_QW ?? rows?.[0]?.order_qw ?? 'W')
        .trim()
        .toUpperCase();
      return v === 'Q' ? 'Q' : 'W';
    } catch {
      return 'W';
    }
  }

  const pendingApi = createSalesOrderPending({
    runQuery,
    parseDateOnly,
    SO_TYPE,
    normCode,
    normStatus,
    num,
    formatDateOut,
    fetchSorderQw,
  });

  /** VFP G_WGTKQ from DEFVALUE.WGT_K_Q — K = weight×rate/100, Q = weight×rate. */
  async function fetchWgtKq(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(WGT_K_Q, 'K') AS WGT_K_Q FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const v = String(rows?.[0]?.WGT_K_Q ?? rows?.[0]?.wgt_k_q ?? 'K')
        .trim()
        .toUpperCase()
        .slice(0, 1);
      return v === 'Q' ? 'Q' : 'K';
    } catch {
      return 'K';
    }
  }

  async function assertMasterCode(comp_code, code, comp_uid, label) {
    const cc = Number(comp_code) || 0;
    const c = normCode(code);
    if (!c) return null;
    const rows = await runQuery(
      `SELECT CODE, NAME, CITY FROM MASTER WHERE COMP_CODE = :comp_code AND TRIM(CODE) = TRIM(:code)`,
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
      city: String(row.CITY ?? row.city ?? '').trim(),
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
      `SELECT NVL(MAX(SO_NO), 0) + 1 AS NEXT_NO FROM SORDER WHERE COMP_CODE = :comp_code AND TYPE = :type`,
      { comp_code: cc, type: SO_TYPE },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  async function loadSalesOrder(comp_code, comp_uid, so_no, so_date) {
    const cc = Number(comp_code) || 0;
    const no = Number(so_no) || 0;
    if (!no) {
      const err = new Error('SO number is required.');
      err.status = 400;
      throw err;
    }
    const sdt = so_date ? parseDateOnly(so_date) : null;
    const binds = { comp_code: cc, type: SO_TYPE, so_no: no };
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
        C.CITY AS PARTY_CITY,
        D.NAME AS BK_NAME,
        G.GOD_NAME
      FROM SORDER A
      LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) AND A.SO_NO = :so_no${dateClause}
      ORDER BY A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    if (!rows?.length) {
      const err = new Error('Sales order not found.');
      err.status = 404;
      throw err;
    }
    const h = rows[0];
    const header = {
      type: SO_TYPE,
      so_no: Number(h.SO_NO ?? h.so_no ?? 0) || no,
      so_date: formatDateOut(h.SO_DATE ?? h.so_date),
      delv_date: formatDateOut(h.DELV_DATE ?? h.delv_date),
      code: normCode(h.CODE ?? h.code),
      party_name: String(h.PARTY_NAME ?? h.party_name ?? '').trim(),
      party_city: String(h.PARTY_CITY ?? h.party_city ?? '').trim(),
      bk_code: normCode(h.BK_CODE ?? h.bk_code),
      bk_name: String(h.BK_NAME ?? h.bk_name ?? '').trim(),
      d_e: normDE(h.D_E ?? h.d_e),
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
      fgt_rate: num(h.FGT_RATE ?? h.fgt_rate),
      rake_truck: String(h.RAKE_TRUCK ?? h.rake_truck ?? '').trim().toUpperCase(),
      delv_city: String(h.DELV_CITY ?? h.delv_city ?? '').trim(),
      vr_date: formatDateOut(h.VR_DATE ?? h.vr_date),
      vr_no: Number(h.VR_NO ?? h.vr_no ?? 0) || 0,
      vr_type: String(h.VR_TYPE ?? h.vr_type ?? '').trim(),
      vr_type_type: String(h.VR_TYPE_TYPE ?? h.vr_type_type ?? '').trim(),
      dr_amt: num(h.DR_AMT ?? h.dr_amt),
      cgst_per: num(h.CGST_PER ?? h.cgst_per),
      sgst_per: num(h.SGST_PER ?? h.sgst_per),
      igst_per: num(h.IGST_PER ?? h.igst_per),
      cgst_amt: num(h.CGST_AMT ?? h.cgst_amt),
      sgst_amt: num(h.SGST_AMT ?? h.sgst_amt),
      igst_amt: num(h.IGST_AMT ?? h.igst_amt),
      bill_amt: num(h.BILL_AMT ?? h.bill_amt),
    };
    const lines = rows.map((r, idx) => ({
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      amt_cal: String(r.AMT_CAL ?? r.amt_cal ?? 'W').trim().toUpperCase() || 'W',
      usd_rate: num(r.USD_RATE ?? r.usd_rate),
      conv_rate: num(r.CONV_RATE ?? r.conv_rate),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
    }));
    return { ok: true, header, lines };
  }

  async function listSalesOrders(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc, type: SO_TYPE };
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
        FROM SORDER A
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

  async function findSalesOrderByPoNo(comp_code, comp_uid, po_no) {
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
        FROM SORDER A
        WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type)
          AND UPPER(TRIM(NVL(A.PO_NO, ' '))) = UPPER(TRIM(:po_no))
        GROUP BY A.SO_NO, TRUNC(A.SO_DATE)
        ORDER BY MIN(A.SO_DATE) DESC, A.SO_NO DESC
      ) WHERE ROWNUM = 1`;
    const rows = await runQuery(sql, { comp_code: cc, type: SO_TYPE, po_no: pono }, comp_uid);
    const hit = rows?.[0];
    if (!hit) {
      const err = new Error(`P.O.No. "${pono}" not found.`);
      err.status = 404;
      throw err;
    }
    const so_no = Number(hit.SO_NO ?? hit.so_no ?? 0) || 0;
    const so_date = formatDateOut(hit.SO_DATE ?? hit.so_date);
    return loadSalesOrder(cc, comp_uid, so_no, so_date);
  }

  /** VFP PRG\sorder.prg SOCHK — SORDER + ITEMMAST + MASTER (+broker), optional filters. */
  async function fetchSalesOrderChecklist(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = {
      comp_code: cc,
      type: SO_TYPE,
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
    const itemCode = Number(opts.item_code) || 0;
    if (itemCode) {
      binds.item_code = itemCode;
      where += ' AND A.ITEM_CODE = :item_code';
    }
    const rakeTruck = String(opts.rake_truck ?? '').trim().toUpperCase().slice(0, 1);
    if (rakeTruck) {
      binds.rake_truck = rakeTruck;
      where += " AND TRIM(NVL(A.RAKE_TRUCK, ' ')) = TRIM(:rake_truck)";
    }
    const dE = String(opts.d_e ?? '').trim().toUpperCase().slice(0, 1);
    if (dE === 'D' || dE === 'E') {
      binds.d_e = dE;
      where += " AND NVL(A.D_E, 'D') = :d_e";
    }
    const godCode = normCode(opts.god_code);
    if (godCode) {
      binds.god_code = godCode;
      where += ' AND TRIM(NVL(A.GOD_CODE, :god_code)) = TRIM(:god_code)';
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
        NVL(A.WEIGHT, 0) AS WEIGHT,
        NVL(A.USD_RATE, 0) AS USD_RATE,
        NVL(A.CONV_RATE, 0) AS CONV_RATE,
        NVL(A.RATE, 0) AS RATE,
        NVL(A.AMOUNT, 0) AS AMOUNT,
        NVL(A.FGT_RATE, 0) AS FGT_RATE,
        NVL(A.PO_NO, ' ') AS PO_NO,
        NVL(A.P_CONDITION, ' ') AS P_CONDITION,
        NVL(A.DELV_MTH, ' ') AS DELV_MTH,
        NVL(A.REMARKS, ' ') AS REMARKS,
        NVL(A.REMARKS2, ' ') AS REMARKS2,
        NVL(A.REMARKS3, ' ') AS REMARKS3,
        NVL(A.CLEAR_YN, ' ') AS CLEAR_YN,
        NVL(A.RAKE_TRUCK, ' ') AS RAKE_TRUCK,
        NVL(A.D_E, 'D') AS D_E,
        NVL(A.DELV_CITY, ' ') AS DELV_CITY,
        TRIM(NVL(A.GOD_CODE, ' ')) AS GOD_CODE,
        NVL(A.PMT_DUE_DAYS, 0) AS PMT_DUE_DAYS,
        NVL(A.DR_AMT, 0) AS DR_AMT
      FROM SORDER A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
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
      weight: num(r.WEIGHT ?? r.weight),
      usd_rate: num(r.USD_RATE ?? r.usd_rate),
      conv_rate: num(r.CONV_RATE ?? r.conv_rate),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      fgt_rate: num(r.FGT_RATE ?? r.fgt_rate),
      po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
      p_condition: String(r.P_CONDITION ?? r.p_condition ?? '').trim(),
      delv_mth: String(r.DELV_MTH ?? r.delv_mth ?? '').trim(),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      remarks2: String(r.REMARKS2 ?? r.remarks2 ?? '').trim(),
      remarks3: String(r.REMARKS3 ?? r.remarks3 ?? '').trim(),
      clear_yn: String(r.CLEAR_YN ?? r.clear_yn ?? '').trim(),
      rake_truck: String(r.RAKE_TRUCK ?? r.rake_truck ?? '').trim(),
      d_e: String(r.D_E ?? r.d_e ?? 'D').trim().toUpperCase() || 'D',
      delv_city: String(r.DELV_CITY ?? r.delv_city ?? '').trim(),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      pmt_due_days: Number(r.PMT_DUE_DAYS ?? r.pmt_due_days ?? 0) || 0,
      dr_amt: num(r.DR_AMT ?? r.dr_amt),
    }));
  }

  function soStatusUnit(status) {
    const s = normStatus(status);
    if (s === 'B') return 'BAGS';
    if (s === 'K') return 'KATTA';
    if (s === 'H') return 'HKATTA';
    return '';
  }

  /** VFP PRG\sorder.prg SOPNT — print cursor with party address/GST/HSN, USD amount, PMT_DUE_DATE. */
  async function fetchSalesOrdersForPrint(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const sbno = Math.max(1, Number(opts.sbno) || 1);
    const ebno = Math.max(sbno, Number(opts.ebno) || sbno);
    const dE = String(opts.d_e ?? '').trim().toUpperCase().slice(0, 1);
    const binds = { comp_code: cc, type: SO_TYPE, sbno, ebno };
    let deClause = '';
    if (dE === 'D' || dE === 'E') {
      binds.d_e = dE;
      deClause = " AND NVL(A.D_E, 'D') = :d_e";
    }
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
        NVL(A.USD_RATE, 0) AS USD_RATE,
        NVL(A.CONV_RATE, 0) AS CONV_RATE,
        NVL(A.RATE, 0) AS RATE,
        NVL(A.AMOUNT, 0) AS AMOUNT,
        NVL(A.CGST_PER, 0) AS CGST_PER,
        NVL(A.SGST_PER, 0) AS SGST_PER,
        NVL(A.IGST_PER, 0) AS IGST_PER,
        NVL(A.CGST_AMT, 0) AS CGST_AMT,
        NVL(A.SGST_AMT, 0) AS SGST_AMT,
        NVL(A.IGST_AMT, 0) AS IGST_AMT,
        NVL(A.BILL_AMT, 0) AS BILL_AMT,
        NVL(A.D_E, 'D') AS D_E,
        NVL(A.FGT_RATE, 0) AS FGT_RATE,
        NVL(A.RAKE_TRUCK, ' ') AS RAKE_TRUCK,
        NVL(A.DELV_CITY, ' ') AS DELV_CITY,
        NVL(A.PO_NO, ' ') AS PO_NO,
        NVL(A.P_CONDITION, ' ') AS P_CONDITION,
        NVL(A.DELV_MTH, ' ') AS DELV_MTH,
        NVL(A.REMARKS, ' ') AS REMARKS,
        NVL(A.REMARKS2, ' ') AS REMARKS2,
        NVL(A.REMARKS3, ' ') AS REMARKS3,
        NVL(A.PMT_DUE_DAYS, 0) AS PMT_DUE_DAYS,
        TRUNC(A.SO_DATE) + NVL(A.PMT_DUE_DAYS, 0) AS PMT_DUE_DATE
      FROM SORDER A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND A.SO_NO BETWEEN :sbno AND :ebno${deClause}
      ORDER BY A.SO_DATE, A.SO_NO, A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
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
            d_e: String(r.D_E ?? r.d_e ?? 'D').trim().toUpperCase() || 'D',
            fgt_rate: num(r.FGT_RATE ?? r.fgt_rate),
            rake_truck: String(r.RAKE_TRUCK ?? r.rake_truck ?? '').trim(),
            delv_city: String(r.DELV_CITY ?? r.delv_city ?? '').trim(),
            po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
            p_condition: String(r.P_CONDITION ?? r.p_condition ?? '').trim(),
            delv_mth: String(r.DELV_MTH ?? r.delv_mth ?? '').trim(),
            remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
            remarks2: String(r.REMARKS2 ?? r.remarks2 ?? '').trim(),
            remarks3: String(r.REMARKS3 ?? r.remarks3 ?? '').trim(),
            cgst_per: num(r.CGST_PER ?? r.cgst_per),
            sgst_per: num(r.SGST_PER ?? r.sgst_per),
            igst_per: num(r.IGST_PER ?? r.igst_per),
            cgst_amt: 0,
            sgst_amt: 0,
            igst_amt: 0,
            bill_amt: 0,
          },
          lines: [],
          totals: { qnty: 0, weight: 0, amount: 0, usd_amount: 0 },
        });
      }
      const order = grouped.get(key);
      const qnty = num(r.QNTY ?? r.qnty);
      const weight = num(r.WEIGHT ?? r.weight);
      const amount = num(r.AMOUNT ?? r.amount);
      const usdRate = num(r.USD_RATE ?? r.usd_rate);
      const status = normStatus(r.STATUS ?? r.status);
      // VFP: GST amounts / BILL_AMT stored on first line only — take max across lines.
      order.header.cgst_amt = Math.max(order.header.cgst_amt, num(r.CGST_AMT ?? r.cgst_amt));
      order.header.sgst_amt = Math.max(order.header.sgst_amt, num(r.SGST_AMT ?? r.sgst_amt));
      order.header.igst_amt = Math.max(order.header.igst_amt, num(r.IGST_AMT ?? r.igst_amt));
      order.header.bill_amt = Math.max(order.header.bill_amt, num(r.BILL_AMT ?? r.bill_amt));
      order.lines.push({
        trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        hsn_code: String(r.HSN_CODE ?? r.hsn_code ?? '').trim(),
        status,
        status_unit: soStatusUnit(status),
        qnty,
        weight,
        usd_rate: usdRate,
        conv_rate: num(r.CONV_RATE ?? r.conv_rate),
        usd_amount: Math.round(weight * usdRate * 100) / 100,
        rate: num(r.RATE ?? r.rate),
        amount,
      });
      order.totals.qnty += qnty;
      order.totals.weight += weight;
      order.totals.amount += amount;
      order.totals.usd_amount += Math.round(weight * usdRate * 100) / 100;
    }
    for (const order of grouped.values()) {
      const h = order.header;
      if (!h.bill_amt) {
        h.bill_amt = Math.round((order.totals.amount + h.cgst_amt + h.sgst_amt + h.igst_amt) * 100) / 100;
      }
    }
    return { orders: Array.from(grouped.values()) };
  }

  function normalizeLine(ln, idx, defaultQw, wgtKq) {
    const item_code = Number(ln.item_code ?? ln.ITEM_CODE ?? 0) || 0;
    const line = {
      trn_no: Number(ln.trn_no ?? ln.TRN_NO ?? idx + 1) || idx + 1,
      item_code,
      status: normStatus(ln.status ?? ln.STATUS),
      qnty: num(ln.qnty ?? ln.QNTY),
      weight: num(ln.weight ?? ln.WEIGHT),
      amt_cal: String(ln.amt_cal ?? ln.AMT_CAL ?? defaultQw).trim().toUpperCase() || defaultQw,
      usd_rate: num(ln.usd_rate ?? ln.USD_RATE),
      conv_rate: num(ln.conv_rate ?? ln.CONV_RATE),
      rate: num(ln.rate ?? ln.RATE),
      amount: num(ln.amount ?? ln.AMOUNT),
    };
    line.rate = calcLineRate(line);
    line.amount = calcLineAmount(line, defaultQw, wgtKq);
    return line;
  }

  async function saveSalesOrder(comp_code, comp_year, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    const mode = String(body.mode ?? 'new').trim().toLowerCase();
    await assertSorderPermission(user_name, comp_uid, mode === 'edit' ? 'edit' : 'add');

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
      const err = new Error('Party code is required.');
      err.status = 400;
      throw err;
    }
    await assertMasterCode(cc, party, comp_uid, 'Party');
    const bk = normCode(body.bk_code ?? body.BK_CODE);
    if (bk) await assertMasterCode(cc, bk, comp_uid, 'Broker');

    const defaultQw = await fetchSorderQw(cc, comp_uid);
    const wgtKq = await fetchWgtKq(cc, comp_uid);
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn
      .map((ln, idx) => normalizeLine(ln, idx, defaultQw, wgtKq))
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

    const untaxed = lines.reduce((s, ln) => s + num(ln.amount), 0);
    const cgst_per = num(body.cgst_per ?? body.CGST_PER);
    const sgst_per = num(body.sgst_per ?? body.SGST_PER);
    const igst_per = num(body.igst_per ?? body.IGST_PER);
    const cgst_amt =
      body.cgst_amt != null && body.cgst_amt !== ''
        ? num(body.cgst_amt)
        : Math.round((untaxed * cgst_per) / 100 * 100) / 100;
    const sgst_amt =
      body.sgst_amt != null && body.sgst_amt !== ''
        ? num(body.sgst_amt)
        : Math.round((untaxed * sgst_per) / 100 * 100) / 100;
    const igst_amt =
      body.igst_amt != null && body.igst_amt !== ''
        ? num(body.igst_amt)
        : Math.round((untaxed * igst_per) / 100 * 100) / 100;

    const header = {
      so_no,
      so_date: sdt,
      delv_date: parseDateOnly(body.delv_date ?? body.DELV_DATE),
      code: party,
      bk_code: bk,
      d_e: normDE(body.d_e ?? body.D_E),
      god_code: normCode(body.god_code ?? body.GOD_CODE),
      po_no: String(body.po_no ?? body.PO_NO ?? '').trim().slice(0, 50),
      clear_yn: String(body.clear_yn ?? body.CLEAR_YN ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
      p_condition: String(body.p_condition ?? body.P_CONDITION ?? '').trim().slice(0, 50),
      delv_mth: String(body.delv_mth ?? body.DELV_MTH ?? '').trim().slice(0, 50),
      remarks: String(body.remarks ?? body.REMARKS ?? '').trim().slice(0, 150),
      remarks2: String(body.remarks2 ?? body.REMARKS2 ?? '').trim().slice(0, 150),
      remarks3: String(body.remarks3 ?? body.REMARKS3 ?? '').trim().slice(0, 150),
      pmt_due_days: Number(body.pmt_due_days ?? body.PMT_DUE_DAYS ?? 0) || 0,
      fgt_rate: num(body.fgt_rate ?? body.FGT_RATE),
      rake_truck: String(body.rake_truck ?? body.RAKE_TRUCK ?? '').trim().toUpperCase().slice(0, 1),
      delv_city: String(body.delv_city ?? body.DELV_CITY ?? '').trim().slice(0, 50),
      vr_date: parseDateOnly(body.vr_date ?? body.VR_DATE),
      vr_no: Number(body.vr_no ?? body.VR_NO ?? 0) || 0,
      vr_type: String(body.vr_type ?? body.VR_TYPE ?? '').trim().slice(0, 2),
      vr_type_type: String(body.vr_type_type ?? body.VR_TYPE_TYPE ?? '').trim().slice(0, 1),
      dr_amt: num(body.dr_amt ?? body.DR_AMT),
      cgst_per,
      sgst_per,
      igst_per,
      cgst_amt,
      sgst_amt,
      igst_amt,
      bill_amt:
        body.bill_amt != null && body.bill_amt !== ''
          ? num(body.bill_amt)
          : Math.round((untaxed + cgst_amt + sgst_amt + igst_amt) * 100) / 100,
    };

    const user = String(body.user_name ?? body.USER_NAME ?? req?.user?.name ?? 'WEB').trim().slice(0, 10);
    const entDate = new Date();

    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await q(
        `DELETE FROM SORDER WHERE COMP_CODE = :comp_code AND TYPE = :type AND SO_NO = :so_no`,
        { comp_code: cc, type: SO_TYPE, so_no }
      );
      const ins = `
        INSERT INTO SORDER (
          COMP_YEAR, COMP_CODE, TYPE, SO_NO, SO_DATE, CODE, PO_NO, TRN_NO, ITEM_CODE,
          QNTY, WEIGHT, RATE, AMOUNT, REMARKS, USER_NAME, ENT_DATE, STATUS,
          DELV_DATE, BK_CODE, P_CONDITION, DELV_MTH, AMT_CAL, REMARKS2, REMARKS3,
          CLEAR_YN, PMT_DUE_DAYS, GOD_CODE, D_E, RAKE_TRUCK, DELV_CITY, FGT_RATE,
          USD_RATE, CONV_RATE,
          CGST_PER, SGST_PER, IGST_PER, CGST_AMT, SGST_AMT, IGST_AMT, BILL_AMT,
          VR_DATE, VR_NO, VR_TYPE, VR_TYPE_TYPE, DR_AMT
        ) VALUES (
          :comp_year, :comp_code, :type, :so_no, :so_date, :code, :po_no, :trn_no, :item_code,
          :qnty, :weight, :rate, :amount, :remarks, :user_name, :ent_date, :status,
          :delv_date, :bk_code, :p_condition, :delv_mth, :amt_cal, :remarks2, :remarks3,
          :clear_yn, :pmt_due_days, :god_code, :d_e, :rake_truck, :delv_city, :fgt_rate,
          :usd_rate, :conv_rate,
          :cgst_per, :sgst_per, :igst_per, :cgst_amt, :sgst_amt, :igst_amt, :bill_amt,
          :vr_date, :vr_no, :vr_type, :vr_type_type, :dr_amt
        )`;
      for (let i = 0; i < lines.length; i += 1) {
        const ln = lines[i];
        const first = i === 0;
        await q(ins, {
          comp_year: cy,
          comp_code: cc,
          type: SO_TYPE,
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
          d_e: header.d_e,
          rake_truck: header.rake_truck,
          delv_city: header.delv_city,
          fgt_rate: header.fgt_rate,
          usd_rate: header.d_e === 'E' ? ln.usd_rate : 0,
          conv_rate: header.d_e === 'E' ? ln.conv_rate : 0,
          // VFP: GST % on all lines; GST amounts + BILL_AMT on first line only
          cgst_per: header.cgst_per,
          sgst_per: header.sgst_per,
          igst_per: header.igst_per,
          cgst_amt: first ? header.cgst_amt : 0,
          sgst_amt: first ? header.sgst_amt : 0,
          igst_amt: first ? header.igst_amt : 0,
          bill_amt: first ? header.bill_amt : 0,
          vr_date: header.vr_date,
          vr_no: header.vr_no,
          vr_type: header.vr_type,
          vr_type_type: header.vr_type_type,
          dr_amt: header.dr_amt,
        });
      }
    });

    return { ok: true, so_no, so_date: formatDateOut(sdt), message: 'Sales order saved.' };
  }

  async function deleteSalesOrder(comp_code, comp_uid, so_no, so_date, user_name) {
    await assertSorderPermission(user_name, comp_uid, 'delete');
    const cc = Number(comp_code) || 0;
    const no = Number(so_no) || 0;
    if (!no) {
      const err = new Error('SO number is required.');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, type: SO_TYPE, so_no: no };
    let sql = `DELETE FROM SORDER WHERE COMP_CODE = :comp_code AND TYPE = :type AND SO_NO = :so_no`;
    const soDateBind = formatDateBind(so_date);
    if (soDateBind) {
      binds.so_date = soDateBind;
      sql += " AND TRUNC(SO_DATE) = TRUNC(TO_DATE(:so_date, 'DD-MM-YYYY'))";
    }
    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      const existing = await loadSalesOrder(cc, comp_uid, no, so_date).catch(() => null);
      if (!existing) {
        const err = new Error('Sales order not found.');
        err.status = 404;
        throw err;
      }
      await q(sql, binds);
    });
    return { ok: true, message: 'Sales order deleted.' };
  }

  function registerRoutes(app) {
    app.get('/api/sales-order/user-permissions', async (req, res) => {
      try {
        const { comp_uid, user_name } = req.query;
        if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
          return res.status(400).json({ error: 'comp_uid and user_name are required' });
        }
        const data = await fetchSorderUserPermissions(String(user_name));
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/context', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertSorderPermission(user_name, comp_uid, 'access');
        const [sorder_q_w, wgt_kq] = await Promise.all([
          fetchSorderQw(comp_code, comp_uid),
          fetchWgtKq(comp_code, comp_uid),
        ]);
        res.json({ ok: true, type: SO_TYPE, sorder_q_w, wgt_kq });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertSorderPermission(user_name, comp_uid, 'access');
        const so_no = await fetchNextSoNo(comp_code, comp_uid);
        res.json({ ok: true, so_no, type: SO_TYPE });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sdt, edt, so_date, po_no, party } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const rows = await listSalesOrders(comp_code, comp_uid, {
          sdt: sdt || so_date,
          edt,
          po_no,
          party,
        });
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/list error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/checklist', async (req, res) => {
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
          item_code,
          rake_truck,
          d_e,
          god_code,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const rows = await fetchSalesOrderChecklist(comp_code, comp_uid, {
          sdt,
          edt,
          sbno,
          ebno,
          code,
          bk_code,
          item_code,
          rake_truck,
          d_e,
          god_code,
        });
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/checklist error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/print-batch', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sbno, ebno, d_e } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const data = await fetchSalesOrdersForPrint(comp_code, comp_uid, { sbno, ebno, d_e });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/print-batch error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/pending-summary', async (req, res) => {
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
          so_no,
          qnty_ignore,
          rake_truck,
          d_e,
          god_code,
          msc,
          rpt_type,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const data = await pendingApi.fetchPendingSummary(comp_code, comp_uid, {
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          so_no,
          qnty_ignore,
          rake_truck,
          d_e,
          god_code,
          msc,
          rpt_type,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/pending-summary error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/pending-detail', async (req, res) => {
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
          so_no,
          qnty_ignore,
          rake_truck,
          d_e,
          god_code,
          msc,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const data = await pendingApi.fetchPendingDetail(comp_code, comp_uid, {
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          so_no,
          qnty_ignore,
          rake_truck,
          d_e,
          god_code,
          msc,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/pending-detail error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/pending-so-do-sale', async (req, res) => {
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
          so_no,
          qnty_ignore,
          rake_truck,
          d_e,
          god_code,
          msc,
        } = req.query;
        if (!comp_code) {
          return res.status(400).json({ error: 'comp_code is required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const data = await pendingApi.fetchPendingSoDoSale(comp_code, comp_uid, {
          sdt,
          edt,
          code,
          item_code,
          bk_code,
          so_no,
          qnty_ignore,
          rake_truck,
          d_e,
          god_code,
          msc,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/pending-so-do-sale error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order/by-po-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, po_no } = req.query;
        if (!comp_code || !po_no) {
          return res.status(400).json({ error: 'comp_code and po_no are required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const data = await findSalesOrderByPoNo(comp_code, comp_uid, po_no);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order/by-po-no error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sales-order', async (req, res) => {
      try {
        const { comp_code, comp_uid, so_no, so_date, user_name } = req.query;
        if (!comp_code || !so_no) {
          return res.status(400).json({ error: 'comp_code and so_no are required' });
        }
        await assertSorderPermission(user_name, comp_uid, 'access');
        const data = await loadSalesOrder(comp_code, comp_uid, so_no, so_date);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order GET error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.post('/api/sales-order', async (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = body.comp_code ?? body.COMP_CODE;
        const comp_year = body.comp_year ?? body.COMP_YEAR ?? 0;
        const comp_uid = body.comp_uid ?? body.COMP_UID;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const result = await saveSalesOrder(comp_code, comp_year, comp_uid, body, req);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order POST error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.delete('/api/sales-order', async (req, res) => {
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
        const result = await deleteSalesOrder(comp_code, comp_uid, so_no, so_date, user_name);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sales-order DELETE error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });
  }

  return {
    registerRoutes,
    loadSalesOrder,
    saveSalesOrder,
    deleteSalesOrder,
    fetchNextSoNo,
  };
}

module.exports = { createSalesOrder, SO_TYPE };
