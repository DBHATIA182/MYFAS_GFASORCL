/**
 * Goods Inward Notes — VFP DO FORM inward WITH 'IN',G_BLNKDT,0 → INWARD.TYPE = 'IN'.
 */

'use strict';

const INWARD_TYPE = 'IN';

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

function resolveUserName(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const q = req?.query && typeof req.query === 'object' ? req.query : {};
  return String(b.user_name ?? b.USER_NAME ?? q.user_name ?? q.USER_NAME ?? req?.user?.name ?? '').trim();
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

function calcNetWeight(gWeight, dWeight) {
  return Math.max(0, Math.round((num(gWeight) - num(dWeight)) * 1000) / 1000);
}

function calcLineAmount(weight, rate) {
  return Math.round(num(weight) * num(rate) * 100) / 100;
}

function inwardStatusUnit(status) {
  const s = normStatus(status);
  if (s === 'B') return 'BAGS';
  if (s === 'K') return 'KATTA';
  if (s === 'H') return 'HKATTA';
  return '';
}

function inwardPrintTitle(rtype) {
  return String(rtype || INWARD_TYPE).trim().toUpperCase() === 'OU' ? 'DELIVERY ORDER' : 'GATE PASS/INWARD';
}

function inwardChecklistTitle(rtype) {
  return String(rtype || INWARD_TYPE).trim().toUpperCase() === 'OU'
    ? 'GATE PASS/OUTWARD REGISTER'
    : 'INWARD REGISTER';
}

/** Optional INWARD columns vary by company schema (setdata2 migration history). */
const INWARD_INSERT_FIELDS = [
  { col: 'COMP_YEAR', bind: 'comp_year' },
  { col: 'COMP_CODE', bind: 'comp_code' },
  { col: 'TYPE', bind: 'type' },
  { col: 'BILL_NO', bind: 'bill_no' },
  { col: 'BILL_DATE', bind: 'bill_date', expr: "TO_DATE(:bill_date, 'DD-MM-YYYY')" },
  { col: 'CODE', bind: 'code' },
  { col: 'REF_NO', bind: 'ref_no' },
  { col: 'TRN_NO', bind: 'trn_no' },
  { col: 'ITEM_CODE', bind: 'item_code' },
  { col: 'STATUS', bind: 'status' },
  { col: 'GOD_CODE', bind: 'god_code' },
  { col: 'QNTY', bind: 'qnty' },
  { col: 'G_WEIGHT', bind: 'g_weight' },
  { col: 'D_WEIGHT', bind: 'd_weight' },
  { col: 'WEIGHT', bind: 'weight' },
  { col: 'RATE', bind: 'rate' },
  { col: 'AMOUNT', bind: 'amount' },
  { col: 'COST_CODE', bind: 'cost_code' },
  { col: 'GR_NO', bind: 'gr_no' },
  { col: 'TPT', bind: 'tpt' },
  { col: 'TRUCK_NO', bind: 'truck_no' },
  { col: 'FORM', bind: 'form' },
  { col: 'REMARKS', bind: 'remarks' },
  { col: 'USER_NAME', bind: 'user_name' },
  { col: 'ENT_DATE', expr: 'SYSDATE' },
  { col: 'B_CODE', bind: 'b_code' },
  { col: 'PO_NO', bind: 'po_no' },
  { col: 'BARD_ITEM_CODE', bind: 'bard_item_code' },
  { col: 'PACKING', bind: 'packing' },
  { col: 'TIME_IN', bind: 'time_in' },
  { col: 'TIME_OUT', bind: 'time_out' },
  { col: 'DK_WEIGHT', bind: 'dk_weight' },
  { col: 'BILL_WEIGHT', bind: 'bill_weight' },
  { col: 'DK_WEIGHT_EMPTY', bind: 'dk_weight_empty' },
  { col: 'DK_WEIGHT_NET', bind: 'dk_weight_net' },
];

function createGoodsInward({ runQuery, parseDateOnly, withCompTransaction, runHubQuery }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createGoodsInward requires runQuery and parseDateOnly');
  }
  const queryHub = typeof runHubQuery === 'function' ? runHubQuery : runQuery;
  const inwardColumnCache = new Map();

  async function getInwardColumns(comp_uid, q) {
    const key = String(comp_uid || '_default').trim().toUpperCase();
    if (inwardColumnCache.has(key)) return inwardColumnCache.get(key);
    try {
      const rows = await q(
        `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'INWARD' ORDER BY COLUMN_ID`
      );
      const set = new Set(rows.map((r) => String(r.COLUMN_NAME ?? r.column_name).toUpperCase()));
      inwardColumnCache.set(key, set);
      return set;
    } catch {
      const fallback = new Set(INWARD_INSERT_FIELDS.map((f) => f.col));
      inwardColumnCache.set(key, fallback);
      return fallback;
    }
  }

  function buildInwardInsertSql(cols) {
    const active = INWARD_INSERT_FIELDS.filter((f) => cols.has(f.col));
    const names = active.map((f) => f.col).join(', ');
    const vals = active.map((f) => f.expr || `:${f.bind}`).join(', ');
    return `INSERT INTO INWARD (${names}) VALUES (${vals})`;
  }

  function buildInwardLineBinds({ cy, cc, bill_no, billDateBind, header, ln, user }) {
    return {
      comp_year: cy,
      comp_code: cc,
      type: INWARD_TYPE,
      bill_no,
      bill_date: billDateBind,
      code: header.code,
      ref_no: '',
      trn_no: ln.trn_no,
      item_code: ln.item_code,
      status: ln.status,
      god_code: header.god_code,
      qnty: ln.qnty,
      g_weight: ln.g_weight,
      d_weight: ln.d_weight,
      weight: ln.weight,
      rate: ln.rate,
      amount: ln.amount,
      cost_code: ln.cost_code || null,
      gr_no: header.gr_no,
      tpt: header.tpt,
      truck_no: header.truck_no,
      form: '',
      remarks: header.remarks,
      user_name: user,
      b_code: header.bk_code,
      po_no: ln.po_no,
      bard_item_code: ln.bard_item_code || null,
      packing: ln.packing,
      time_in: header.time_in,
      time_out: header.time_out,
      dk_weight: header.dk_weight,
      bill_weight: header.bill_weight,
      dk_weight_empty: header.dk_weight_empty,
      dk_weight_net: header.dk_weight_net,
    };
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

  function formatDateBind(raw) {
    const d = parseDateOnly(raw);
    if (!d) return null;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  async function fetchInwardUserF12String(user_name) {
    const u = String(user_name || '').trim().toUpperCase();
    if (!u) return { f12: '', source: 'empty_user' };
    const tables = ['GRAINFAS.USERS', 'USERS'];
    for (const t of tables) {
      try {
        const rows = await queryHub(
          `SELECT F12 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
          { u },
          { suppressDbErrorLog: true }
        );
        if (rows?.length) {
          const raw = rows[0].F12 ?? rows[0].f12;
          return { f12: raw != null ? String(raw).trim() : '', source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* ignore optional schema/table */
        }
      }
    }
    return { f12: '', source: 'none' };
  }

  function inwardPermissionsFromF12(f12) {
    const str = String(f12 ?? '').trim();
    const padded = (str || '0000').padEnd(4, '0').slice(0, 4);
    const bit = (i) => padded.charAt(i) === '1';
    return {
      canOpen: bit(0),
      canAdd: bit(1),
      canEdit: bit(2),
      canDelete: bit(3),
      flags: 'f12',
    };
  }

  async function fetchInwardUserPermissions(user_name) {
    const { f12, source } = await fetchInwardUserF12String(user_name);
    return { f12, source, ...inwardPermissionsFromF12(f12) };
  }

  async function assertInwardPermission(user_name, comp_uid, kind) {
    const perms = await fetchInwardUserPermissions(user_name);
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

  async function assertItemCode(comp_code, item_code, comp_uid, label = 'Item') {
    const cc = Number(comp_code) || 0;
    const ic = Number(item_code) || 0;
    if (!ic) {
      const err = new Error(`${label} code is required.`);
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
      const err = new Error(`${label} ${ic} not found in item master.`);
      err.status = 400;
      throw err;
    }
    return {
      item_code: ic,
      item_name: String(row.ITEM_NAME ?? row.item_name ?? '').trim(),
      cost_code: '',
    };
  }

  async function fetchNextBillNo(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT NVL(MAX(BILL_NO), 0) + 1 AS NEXT_NO FROM INWARD WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)`,
      { comp_code: cc, type: INWARD_TYPE },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  function normalizeLine(ln, idx) {
    const gWeight = num(ln.g_weight ?? ln.G_WEIGHT);
    const dWeight = num(ln.d_weight ?? ln.D_WEIGHT);
    const weight = calcNetWeight(gWeight, dWeight);
    const rate = num(ln.rate ?? ln.RATE);
    const line = {
      trn_no: Number(ln.trn_no ?? ln.TRN_NO ?? idx + 1) || idx + 1,
      po_no: Number(ln.po_no ?? ln.PO_NO ?? 0) || 0,
      item_code: Number(ln.item_code ?? ln.ITEM_CODE ?? 0) || 0,
      bard_item_code: Number(ln.bard_item_code ?? ln.BARD_ITEM_CODE ?? 0) || 0,
      status: normStatus(ln.status ?? ln.STATUS),
      packing: num(ln.packing ?? ln.PACKING),
      qnty: num(ln.qnty ?? ln.QNTY),
      g_weight: gWeight,
      d_weight: dWeight,
      weight,
      rate,
      amount: calcLineAmount(weight, rate),
      cost_code: String(ln.cost_code ?? ln.COST_CODE ?? '').trim(),
    };
    return line;
  }

  async function loadGoodsInward(comp_code, comp_uid, bill_no, bill_date) {
    const cc = Number(comp_code) || 0;
    const no = Number(bill_no) || 0;
    if (!no) {
      const err = new Error('Inward number is required.');
      err.status = 400;
      throw err;
    }
    const binds = { comp_code: cc, type: INWARD_TYPE, bill_no: no };
    let dateClause = '';
    if (bill_date) {
      const dt = formatDateBind(bill_date);
      if (dt) {
        binds.bill_date = dt;
        dateClause = " AND TRUNC(A.BILL_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))";
      }
    }
    const sql = `
      SELECT
        A.*,
        B.ITEM_NAME,
        C.NAME AS PARTY_NAME,
        C.CITY AS PARTY_CITY,
        D.NAME AS BK_NAME,
        E.ITEM_NAME AS BARD_ITEM_NAME,
        G.GOD_NAME
      FROM INWARD A
      LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.B_CODE = D.CODE
      LEFT JOIN ITEMMAST E ON A.COMP_CODE = E.COMP_CODE AND A.BARD_ITEM_CODE = E.ITEM_CODE
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) AND A.BILL_NO = :bill_no${dateClause}
      ORDER BY A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    if (!rows?.length) {
      const err = new Error('Goods inward note not found.');
      err.status = 404;
      throw err;
    }
    const h = rows[0];
    const header = {
      type: INWARD_TYPE,
      bill_no: Number(h.BILL_NO ?? h.bill_no ?? 0) || no,
      bill_date: formatDateOut(h.BILL_DATE ?? h.bill_date),
      code: normCode(h.CODE ?? h.code),
      party_name: String(h.PARTY_NAME ?? h.party_name ?? '').trim(),
      party_city: String(h.PARTY_CITY ?? h.party_city ?? '').trim(),
      bk_code: normCode(h.B_CODE ?? h.b_code),
      bk_name: String(h.BK_NAME ?? h.bk_name ?? '').trim(),
      god_code: normCode(h.GOD_CODE ?? h.god_code),
      god_name: String(h.GOD_NAME ?? h.god_name ?? '').trim(),
      truck_no: String(h.TRUCK_NO ?? h.truck_no ?? '').trim(),
      dk_weight: num(h.DK_WEIGHT ?? h.dk_weight),
      dk_weight_empty: num(h.DK_WEIGHT_EMPTY ?? h.dk_weight_empty),
      dk_weight_net: num(h.DK_WEIGHT_NET ?? h.dk_weight_net),
      bill_weight: num(h.BILL_WEIGHT ?? h.bill_weight),
      gr_no: String(h.GR_NO ?? h.gr_no ?? '').trim(),
      tpt: String(h.TPT ?? h.tpt ?? '').trim(),
      time_in: String(h.TIME_IN ?? h.time_in ?? '').trim(),
      time_out: String(h.TIME_OUT ?? h.time_out ?? '').trim(),
      remarks: String(h.REMARKS ?? h.remarks ?? '').trim(),
    };
    const lines = rows.map((r, idx) => ({
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      po_no: Number(r.PO_NO ?? r.po_no ?? 0) || 0,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      bard_item_code: Number(r.BARD_ITEM_CODE ?? r.bard_item_code ?? 0) || 0,
      bard_item_name: String(r.BARD_ITEM_NAME ?? r.bard_item_name ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      packing: num(r.PACKING ?? r.packing),
      qnty: num(r.QNTY ?? r.qnty),
      g_weight: num(r.G_WEIGHT ?? r.g_weight),
      d_weight: num(r.D_WEIGHT ?? r.d_weight),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      cost_code: String(r.COST_CODE ?? r.cost_code ?? '').trim(),
    }));
    return { ok: true, header, lines };
  }

  async function listGoodsInward(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc, type: INWARD_TYPE };
    let where = 'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type)';
    if (opts.sdt) {
      const sdt = formatDateBind(opts.sdt);
      if (sdt) {
        binds.sdt = sdt;
        where += " AND TRUNC(A.BILL_DATE) >= TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY'))";
      }
    }
    if (opts.edt) {
      const edt = formatDateBind(opts.edt);
      if (edt) {
        binds.edt = edt;
        where += " AND TRUNC(A.BILL_DATE) <= TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))";
      }
    }
    const partyFilter = String(opts.party ?? '').trim();
    if (partyFilter) {
      binds.party_q = `%${partyFilter.toUpperCase()}%`;
      where += ' AND (UPPER(TRIM(A.CODE)) LIKE :party_q OR UPPER(TRIM(B.NAME)) LIKE :party_q)';
    }
    const sql = `
      SELECT BILL_NO, BILL_DATE, CODE, PARTY_NAME, LINE_COUNT, TOT_AMT FROM (
        SELECT TRUNC(A.BILL_DATE) AS BILL_DATE, A.BILL_NO, A.CODE, B.NAME AS PARTY_NAME,
               COUNT(*) AS LINE_COUNT, SUM(NVL(A.AMOUNT, 0)) AS TOT_AMT
        FROM INWARD A
        JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
        WHERE ${where}
        GROUP BY TRUNC(A.BILL_DATE), A.BILL_NO, A.CODE, B.NAME
        ORDER BY TRUNC(A.BILL_DATE), A.BILL_NO
      ) WHERE ROWNUM <= 1000
      ORDER BY BILL_DATE, BILL_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r) => ({
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      line_count: Number(r.LINE_COUNT ?? r.line_count ?? 0) || 0,
      tot_amt: num(r.TOT_AMT ?? r.tot_amt),
    }));
  }

  async function listInwardKeys(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT TRUNC(BILL_DATE) AS BILL_DATE, BILL_NO
       FROM INWARD
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
       GROUP BY TRUNC(BILL_DATE), BILL_NO
       ORDER BY TRUNC(BILL_DATE), BILL_NO`,
      { comp_code: cc, type: INWARD_TYPE },
      comp_uid
    );
    return (rows || []).map((r) => ({
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
    }));
  }

  async function navigateGoodsInward(comp_code, comp_uid, bill_no, bill_date, direction) {
    const keys = await listInwardKeys(comp_code, comp_uid);
    if (!keys.length) {
      const err = new Error('No goods inward notes found.');
      err.status = 404;
      throw err;
    }
    const dir = String(direction || 'next').trim().toLowerCase();
    const curNo = Number(bill_no) || 0;
    const curDate = formatDateOut(bill_date);
    let idx = keys.findIndex((k) => k.bill_no === curNo && (!curDate || k.bill_date === curDate));
    if (idx === -1) idx = keys.findIndex((k) => k.bill_no === curNo);
    if (dir === 'first' || dir === 'top') return loadGoodsInward(comp_code, comp_uid, keys[0].bill_no, keys[0].bill_date);
    if (dir === 'last' || dir === 'bottom') {
      const last = keys[keys.length - 1];
      return loadGoodsInward(comp_code, comp_uid, last.bill_no, last.bill_date);
    }
    if (dir === 'prev' || dir === 'previous') {
      const pick = idx <= 0 ? keys[0] : keys[idx - 1];
      return loadGoodsInward(comp_code, comp_uid, pick.bill_no, pick.bill_date);
    }
    const pick = idx < 0 || idx >= keys.length - 1 ? keys[keys.length - 1] : keys[idx + 1];
    return loadGoodsInward(comp_code, comp_uid, pick.bill_no, pick.bill_date);
  }

  async function saveGoodsInward(comp_code, comp_year, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    const mode = String(body.mode ?? 'new').trim().toLowerCase();
    await assertInwardPermission(user_name, comp_uid, mode === 'edit' ? 'edit' : 'add');

    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    const billDate = parseDateOnly(body.bill_date ?? body.BILL_DATE);
    if (!billDate) {
      const err = new Error('Date is required.');
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
    const bk = normCode(body.bk_code ?? body.B_CODE ?? body.bk_code);
    if (bk) await assertMasterCode(cc, bk, comp_uid, 'Broker');
    const god = normCode(body.god_code ?? body.GOD_CODE);
    if (!god) {
      const err = new Error('Godown code is required.');
      err.status = 400;
      throw err;
    }

    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn.map((ln, idx) => normalizeLine(ln, idx)).filter((ln) => ln.item_code);
    if (!lines.length) {
      const err = new Error('Enter at least one item line.');
      err.status = 400;
      throw err;
    }
    for (const ln of lines) {
      const item = await assertItemCode(cc, ln.item_code, comp_uid, 'Item');
      if (!ln.cost_code && item.cost_code) ln.cost_code = item.cost_code;
      if (ln.bard_item_code) await assertItemCode(cc, ln.bard_item_code, comp_uid, 'Bardan item');
    }

    let bill_no = Number(body.bill_no ?? body.BILL_NO ?? 0) || 0;
    if (mode === 'new' || !bill_no) {
      bill_no = await fetchNextBillNo(cc, comp_uid);
    }

    const header = {
      bill_no,
      bill_date: billDate,
      code: party,
      bk_code: bk,
      god_code: god,
      truck_no: String(body.truck_no ?? body.TRUCK_NO ?? '').trim().slice(0, 20),
      dk_weight: num(body.dk_weight ?? body.DK_WEIGHT),
      dk_weight_empty: num(body.dk_weight_empty ?? body.DK_WEIGHT_EMPTY),
      dk_weight_net: num(body.dk_weight_net ?? body.DK_WEIGHT_NET),
      bill_weight: num(body.bill_weight ?? body.BILL_WEIGHT),
      gr_no: String(body.gr_no ?? body.GR_NO ?? '').trim().slice(0, 20),
      tpt: String(body.tpt ?? body.TPT ?? '').trim().slice(0, 50),
      time_in: String(body.time_in ?? body.TIME_IN ?? '').trim().slice(0, 15),
      time_out: String(body.time_out ?? body.TIME_OUT ?? '').trim().slice(0, 15),
      remarks: String(body.remarks ?? body.REMARKS ?? '').trim().slice(0, 100),
    };
    if (!header.dk_weight_net && (header.dk_weight || header.dk_weight_empty)) {
      header.dk_weight_net = calcNetWeight(header.dk_weight, header.dk_weight_empty);
    }

    const user = String(body.user_name ?? body.USER_NAME ?? req?.user?.name ?? 'WEB').trim().slice(0, 10);

    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await q(
        `DELETE FROM INWARD WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type) AND BILL_NO = :bill_no`,
        { comp_code: cc, type: INWARD_TYPE, bill_no }
      );
      const billDateBind = formatDateBind(header.bill_date);
      if (!billDateBind) {
        const err = new Error('Date is required.');
        err.status = 400;
        throw err;
      }
      const inwardCols = await getInwardColumns(comp_uid, q);
      const activeFields = INWARD_INSERT_FIELDS.filter((f) => inwardCols.has(f.col));
      const ins = buildInwardInsertSql(inwardCols);
      for (const ln of lines) {
        const allBinds = buildInwardLineBinds({ cy, cc, bill_no, billDateBind, header, ln, user });
        const binds = {};
        for (const f of activeFields) {
          if (f.bind) binds[f.bind] = allBinds[f.bind];
        }
        await q(ins, binds);
      }
    });

    let headerOut;
    let linesOut;
    try {
      const saved = await loadGoodsInward(cc, comp_uid, bill_no, null);
      headerOut = saved.header;
      linesOut = saved.lines;
    } catch {
      const partyRow = await assertMasterCode(cc, party, comp_uid, 'Party').catch(() => null);
      const bkRow = bk ? await assertMasterCode(cc, bk, comp_uid, 'Broker').catch(() => null) : null;
      const godRows = await runQuery(
        `SELECT GOD_CODE, GOD_NAME FROM GODOWN WHERE COMP_CODE = :comp_code AND TRIM(GOD_CODE) = TRIM(:god_code)`,
        { comp_code: cc, god_code: god },
        comp_uid
      ).catch(() => []);
      const godRow = godRows?.[0];
      headerOut = {
        type: INWARD_TYPE,
        bill_no,
        bill_date: formatDateOut(header.bill_date),
        code: party,
        party_name: partyRow?.name || '',
        party_city: partyRow?.city || '',
        bk_code: bk,
        bk_name: bkRow?.name || '',
        god_code: god,
        god_name: String(godRow?.GOD_NAME ?? godRow?.god_name ?? '').trim(),
        truck_no: header.truck_no,
        dk_weight: header.dk_weight,
        dk_weight_empty: header.dk_weight_empty,
        dk_weight_net: header.dk_weight_net,
        bill_weight: header.bill_weight,
        gr_no: header.gr_no,
        tpt: header.tpt,
        time_in: header.time_in,
        time_out: header.time_out,
        remarks: header.remarks,
      };
      linesOut = [];
      for (const ln of lines) {
        const item = await assertItemCode(cc, ln.item_code, comp_uid, 'Item').catch(() => null);
        let bardName = '';
        if (ln.bard_item_code) {
          const bard = await assertItemCode(cc, ln.bard_item_code, comp_uid, 'Bardan item').catch(() => null);
          bardName = bard?.item_name || '';
        }
        linesOut.push({
          trn_no: ln.trn_no,
          po_no: ln.po_no,
          item_code: ln.item_code,
          item_name: item?.item_name || '',
          bard_item_code: ln.bard_item_code,
          bard_item_name: bardName,
          status: ln.status,
          packing: ln.packing,
          qnty: ln.qnty,
          g_weight: ln.g_weight,
          d_weight: ln.d_weight,
          weight: ln.weight,
          rate: ln.rate,
          amount: ln.amount,
          cost_code: ln.cost_code,
        });
      }
    }
    return {
      ok: true,
      message: mode === 'edit' ? `Inward No. ${bill_no} updated.` : `Inward No. ${bill_no} saved.`,
      bill_no,
      bill_date: formatDateOut(header.bill_date),
      header: headerOut,
      lines: linesOut,
    };
  }

  async function deleteGoodsInward(comp_code, comp_uid, bill_no, user_name) {
    await assertInwardPermission(user_name, comp_uid, 'delete');
    const cc = Number(comp_code) || 0;
    const no = Number(bill_no) || 0;
    if (!no) {
      const err = new Error('Inward number is required.');
      err.status = 400;
      throw err;
    }
    const existing = await loadGoodsInward(cc, comp_uid, no, null).catch(() => null);
    if (!existing) {
      const err = new Error('Goods inward note not found.');
      err.status = 404;
      throw err;
    }
    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      await q(
        `DELETE FROM INWARD WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type) AND BILL_NO = :bill_no`,
        { comp_code: cc, type: INWARD_TYPE, bill_no: no }
      );
    });
    return { ok: true, message: `Inward No. ${no} deleted.` };
  }

  async function fetchInwardDefContext(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(SALE_ORDER_TYPE, 'N') AS SALE_ORDER_TYPE,
                NVL(PUR_ORDER_TYPE, 'N') AS PUR_ORDER_TYPE,
                NVL(ORDER_QW, 'W') AS ORDER_QW,
                NVL(PORDER_Q_W, 'W') AS PORDER_Q_W
         FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      const r = rows?.[0] || {};
      const purOrderType = String(
        r.PUR_ORDER_TYPE ?? r.pur_order_type ?? r.SALE_ORDER_TYPE ?? r.sale_order_type ?? 'N'
      )
        .trim()
        .toUpperCase();
      const saleOrderType = purOrderType;
      let orderQw = String(r.ORDER_QW ?? r.order_qw ?? r.PORDER_Q_W ?? r.porder_q_w ?? 'W')
        .trim()
        .toUpperCase();
      if (orderQw !== 'Q') orderQw = 'W';
      return { sale_order_type: saleOrderType, order_qw: orderQw };
    } catch {
      return { sale_order_type: 'N', order_qw: 'W' };
    }
  }

  /** VFP inward POHLP — PORDER vs PURCHASE (defvalue PUR_ORDER_TYPE/G_SORDER_QW, inward.SCT). */
  async function fetchInwardPoHelp(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const ctx = await fetchInwardDefContext(cc, comp_uid);
    const filterByParty = ctx.sale_order_type === 'C';
    const filterCode = filterByParty ? normCode(opts.code) : normCode(opts.bk_code);
    if (!filterCode) {
      const err = new Error(
        filterByParty ? 'Enter party code before PO help.' : 'Enter broker code before PO help.'
      );
      err.status = 400;
      throw err;
    }
    const poField = filterByParty ? 'CODE' : 'BK_CODE';
    const purField = filterByParty ? 'CODE' : 'B_CODE';
    const poRows = await runQuery(
      `SELECT A.SO_NO, TRUNC(A.SO_DATE) AS SO_DATE, A.ITEM_CODE, A.QNTY, A.WEIGHT, A.RATE,
              A.REMARKS, A.BK_CODE, B.ITEM_NAME
       FROM PORDER A
       LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
       WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = 'SO'
         AND TRIM(A.${poField}) = TRIM(:filter_code)
         AND NVL(A.CLEAR_YN, 'N') <> 'Y'`,
      { comp_code: cc, filter_code: filterCode },
      comp_uid
    );

    const ordMap = new Map();
    for (const r of poRows || []) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      const itemCode = Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0;
      const rate = num(r.RATE ?? r.rate);
      const key = `${soNo}|${itemCode}|${rate}`;
      if (!ordMap.has(key)) {
        ordMap.set(key, {
          so_no: soNo,
          so_date: formatDateOut(r.SO_DATE ?? r.so_date),
          item_code: itemCode,
          item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
          rate,
          so_qty: 0,
          so_wgt: 0,
          remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
          bk_code: normCode(r.BK_CODE ?? r.bk_code),
        });
      }
      const o = ordMap.get(key);
      o.so_qty += num(r.QNTY ?? r.qnty);
      o.so_wgt += num(r.WEIGHT ?? r.weight);
    }

    const purRows = await runQuery(
      `SELECT A.SO_NO, A.ITEM_CODE, NVL(A.RATE, 0) AS RATE,
              SUM(NVL(A.QNTY, 0)) AS SL_QTY,
              SUM(NVL(A.WEIGHT, 0)) AS SL_WGT
       FROM PURCHASE A
       WHERE A.COMP_CODE = :comp_code AND NVL(A.SO_NO, 0) <> 0
         AND TRIM(A.${purField}) = TRIM(:filter_code)
       GROUP BY A.SO_NO, A.ITEM_CODE, NVL(A.RATE, 0)`,
      { comp_code: cc, filter_code: filterCode },
      comp_uid
    );
    const purMap = new Map();
    for (const r of purRows || []) {
      const key = `${Number(r.SO_NO ?? r.so_no ?? 0) || 0}|${Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0}|${num(r.RATE ?? r.rate)}`;
      purMap.set(key, { sl_qty: num(r.SL_QTY ?? r.sl_qty), sl_wgt: num(r.SL_WGT ?? r.sl_wgt) });
    }

    const rows = [];
    for (const o of ordMap.values()) {
      const key = `${o.so_no}|${o.item_code}|${o.rate}`;
      const p = purMap.get(key) || { sl_qty: 0, sl_wgt: 0 };
      // VFP inward POHLP: BQTY = SOQTY - SOWGT, BWGT = SOWGT - SLWGT (SOWGT = PO weight).
      const bqty = o.so_qty - o.so_wgt;
      const bwgt = Math.round((o.so_wgt - p.sl_wgt) * 1000) / 1000;
      if (ctx.order_qw === 'Q') {
        if (bqty <= 0) continue;
      } else if (bwgt <= 0) {
        continue;
      }
      rows.push({
        so_no: o.so_no,
        so_date: o.so_date,
        item_code: o.item_code,
        item_name: o.item_name,
        rate: o.rate,
        bqty,
        bwgt,
        remarks: o.remarks,
        bk_code: o.bk_code,
      });
    }
    rows.sort((a, b) => a.so_no - b.so_no || a.item_code - b.item_code || a.rate - b.rate);
    return { ...ctx, rows };
  }

  /** VFP INWARD_PRINT / INWARD_CHK detail rows. */
  function mapInwardDetailRow(r) {
    const status = normStatus(r.STATUS ?? r.status);
    return {
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      city: String(r.CITY ?? r.city ?? '').trim(),
      add1: String(r.ADD1 ?? r.add1 ?? '').trim(),
      add2: String(r.ADD2 ?? r.add2 ?? '').trim(),
      add3: String(r.ADD3 ?? r.add3 ?? '').trim(),
      gst_no: String(r.GST_NO ?? r.gst_no ?? '').trim(),
      state_code: String(r.STATE_CODE ?? r.state_code ?? '').trim(),
      state: String(r.STATE ?? r.state ?? '').trim(),
      bk_code: normCode(r.B_CODE ?? r.b_code ?? r.BK_CODE ?? r.bk_code),
      bk_name: String(r.BK_NAME ?? r.bk_name ?? '').trim(),
      po_no: Number(r.PO_NO ?? r.po_no ?? 0) || 0,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      bard_item_code: Number(r.BARD_ITEM_CODE ?? r.bard_item_code ?? 0) || 0,
      bard_item_name: String(r.BARD_ITEM_NAME ?? r.bard_item_name ?? '').trim(),
      status,
      status_unit: inwardStatusUnit(status),
      packing: num(r.PACKING ?? r.packing),
      qnty: num(r.QNTY ?? r.qnty),
      g_weight: num(r.G_WEIGHT ?? r.g_weight),
      d_weight: num(r.D_WEIGHT ?? r.d_weight),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
      dk_weight: num(r.DK_WEIGHT ?? r.dk_weight),
      dk_weight_empty: num(r.DK_WEIGHT_EMPTY ?? r.dk_weight_empty),
      dk_weight_net: num(r.DK_WEIGHT_NET ?? r.dk_weight_net),
      bill_weight: num(r.BILL_WEIGHT ?? r.bill_weight),
      time_in: String(r.TIME_IN ?? r.time_in ?? '').trim(),
      time_out: String(r.TIME_OUT ?? r.time_out ?? '').trim(),
      remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      gr_no: String(r.GR_NO ?? r.gr_no ?? '').trim(),
      tpt: String(r.TPT ?? r.tpt ?? '').trim(),
      sb_no: 0,
    };
  }

  async function fetchInwardDetailRows(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const rtype = String(opts.rtype || INWARD_TYPE).trim().toUpperCase() || INWARD_TYPE;
    let sbno = Math.max(0, Number(opts.sbno) || 0);
    let ebno = Math.max(0, Number(opts.ebno) || 0);
    if (sbno === 0 && ebno === 0) {
      sbno = 0;
      ebno = 999999;
    } else if (ebno < sbno) {
      ebno = sbno;
    }
    const binds = { comp_code: cc, type: rtype, sbno, ebno };
    let where =
      'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) AND A.BILL_NO BETWEEN :sbno AND :ebno';

    const sdt = formatDateBind(opts.sdt);
    const edt = formatDateBind(opts.edt);
    if (sdt && edt) {
      binds.sdt = sdt;
      binds.edt = edt;
      where +=
        " AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))";
    }

    const partyCode = normCode(opts.code);
    if (partyCode) {
      binds.code = partyCode;
      where += ' AND TRIM(A.CODE) = TRIM(:code)';
    }
    const brokerCode = normCode(opts.bk_code);
    if (brokerCode) {
      binds.bk_code = brokerCode;
      where += ' AND TRIM(NVL(A.B_CODE, :bk_code)) = TRIM(:bk_code)';
    }
    const godCode = normCode(opts.god_code);
    if (godCode) {
      binds.god_code = godCode;
      where += ' AND TRIM(NVL(A.GOD_CODE, :god_code)) = TRIM(:god_code)';
    }
    const itemCode = Number(opts.item_code) || 0;
    if (itemCode) {
      binds.item_code = itemCode;
      where += ' AND A.ITEM_CODE = :item_code';
    }

    const sql = `
      SELECT
        TRUNC(A.BILL_DATE) AS BILL_DATE,
        A.BILL_NO,
        A.TRN_NO,
        TRIM(A.CODE) AS CODE,
        B.NAME AS PARTY_NAME,
        B.CITY,
        B.ADD1,
        B.ADD2,
        B.ADD3,
        B.GST_NO,
        B.STATE_CODE,
        B.STATE,
        TRIM(NVL(A.B_CODE, ' ')) AS B_CODE,
        C.NAME AS BK_NAME,
        NVL(A.PO_NO, 0) AS PO_NO,
        A.ITEM_CODE,
        E.ITEM_NAME,
        NVL(A.BARD_ITEM_CODE, 0) AS BARD_ITEM_CODE,
        D.ITEM_NAME AS BARD_ITEM_NAME,
        NVL(A.PACKING, 0) AS PACKING,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        NVL(A.QNTY, 0) AS QNTY,
        NVL(A.G_WEIGHT, 0) AS G_WEIGHT,
        NVL(A.D_WEIGHT, 0) AS D_WEIGHT,
        NVL(A.WEIGHT, 0) AS WEIGHT,
        NVL(A.RATE, 0) AS RATE,
        NVL(A.AMOUNT, 0) AS AMOUNT,
        TRIM(NVL(A.GOD_CODE, ' ')) AS GOD_CODE,
        TRIM(NVL(A.COST_CODE, ' ')) AS COST_CODE,
        TRIM(NVL(A.TRUCK_NO, ' ')) AS TRUCK_NO,
        NVL(A.DK_WEIGHT, 0) AS DK_WEIGHT,
        NVL(A.DK_WEIGHT_EMPTY, 0) AS DK_WEIGHT_EMPTY,
        NVL(A.DK_WEIGHT_NET, 0) AS DK_WEIGHT_NET,
        NVL(A.BILL_WEIGHT, 0) AS BILL_WEIGHT,
        TRIM(NVL(A.TIME_IN, ' ')) AS TIME_IN,
        TRIM(NVL(A.TIME_OUT, ' ')) AS TIME_OUT,
        TRIM(NVL(A.REMARKS, ' ')) AS REMARKS,
        TRIM(NVL(A.GR_NO, ' ')) AS GR_NO,
        TRIM(NVL(A.TPT, ' ')) AS TPT
      FROM INWARD A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.B_CODE = C.CODE
      LEFT JOIN ITEMMAST D ON A.COMP_CODE = D.COMP_CODE AND A.BARD_ITEM_CODE = D.ITEM_CODE
      JOIN ITEMMAST E ON A.COMP_CODE = E.COMP_CODE AND A.ITEM_CODE = E.ITEM_CODE
      WHERE ${where}
      ORDER BY A.BILL_DATE, A.BILL_NO, A.TRN_NO`;
    const rows = await runQuery(sql, binds, comp_uid);
    const mapped = (rows || []).map(mapInwardDetailRow);

    try {
      const saleRows = await runQuery(
        `SELECT TRIM(A.CODE) AS CODE, NVL(A.GP_NO, 0) AS GP_NO, NVL(A.BILL_NO, 0) AS BILL_NO
         FROM SALE A
         WHERE A.COMP_CODE = :comp_code
         GROUP BY A.CODE, A.GP_NO, A.BILL_NO`,
        { comp_code: cc },
        comp_uid
      );
      const saleMap = new Map();
      for (const s of saleRows || []) {
        const code = normCode(s.CODE ?? s.code);
        const gpNo = Number(s.GP_NO ?? s.gp_no ?? 0) || 0;
        const billNo = Number(s.BILL_NO ?? s.bill_no ?? 0) || 0;
        if (code && gpNo) saleMap.set(`${code}|${gpNo}`, billNo);
      }
      for (const row of mapped) {
        row.sb_no = saleMap.get(`${row.code}|${row.bill_no}`) || 0;
      }
    } catch {
      /* SALE table optional */
    }

    if (String(opts.pending_only || opts.mcp || '').trim().toUpperCase() === 'P') {
      return mapped.filter((r) => !r.sb_no);
    }
    return mapped;
  }

  async function fetchInwardPrintBatch(comp_code, comp_uid, opts = {}) {
    const rtype = String(opts.rtype || INWARD_TYPE).trim().toUpperCase() || INWARD_TYPE;
    const rows = await fetchInwardDetailRows(comp_code, comp_uid, { ...opts, rtype });
    const grouped = new Map();
    for (const row of rows) {
      const key = `${row.bill_no}|${row.bill_date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          header: {
            bill_no: row.bill_no,
            bill_date: row.bill_date,
            head_name: inwardPrintTitle(rtype),
            code: row.code,
            party_name: row.party_name,
            city: row.city,
            add1: row.add1,
            add2: row.add2,
            add3: row.add3,
            gst_no: row.gst_no,
            state_code: row.state_code,
            state: row.state,
            bk_code: row.bk_code,
            bk_name: row.bk_name,
            truck_no: row.truck_no,
            time_in: row.time_in,
            time_out: row.time_out,
            gr_no: row.gr_no,
            tpt: row.tpt,
            remarks: row.remarks,
            dk_weight: row.dk_weight,
            dk_weight_empty: row.dk_weight_empty,
            dk_weight_net: row.dk_weight_net,
            bill_weight: row.bill_weight,
          },
          lines: [],
          totals: { qnty: 0, packing: 0, g_weight: 0, d_weight: 0, weight: 0, amount: 0 },
        });
      }
      const note = grouped.get(key);
      note.lines.push({
        sno: note.lines.length + 1,
        trn_no: row.trn_no,
        po_no: row.po_no,
        item_code: row.item_code,
        item_name: row.item_name,
        bard_item_code: row.bard_item_code,
        bard_item_name: row.bard_item_name,
        status: row.status,
        status_unit: row.status_unit,
        packing: row.packing,
        qnty: row.qnty,
        g_weight: row.g_weight,
        d_weight: row.d_weight,
        weight: row.weight,
        rate: row.rate,
        amount: row.amount,
        cost_code: row.cost_code,
      });
      note.totals.qnty += row.qnty;
      note.totals.packing += row.packing;
      note.totals.g_weight += row.g_weight;
      note.totals.d_weight += row.d_weight;
      note.totals.weight += row.weight;
      note.totals.amount += row.amount;
    }
    return {
      rtype,
      head_name: inwardPrintTitle(rtype),
      notes: Array.from(grouped.values()),
    };
  }

  async function fetchInwardChecklist(comp_code, comp_uid, opts = {}) {
    const rtype = String(opts.rtype || INWARD_TYPE).trim().toUpperCase() || INWARD_TYPE;
    const rows = await fetchInwardDetailRows(comp_code, comp_uid, { ...opts, rtype });
    return {
      head_name: inwardChecklistTitle(rtype),
      rtype,
      rows,
    };
  }

  /** VFP cost centre browse — COST table (F1 on Cost column). */
  async function fetchInwardCostHelp(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT TRIM(COST_NAME) AS COST_NAME, TRIM(COST_CODE) AS COST_CODE
       FROM COST
       WHERE COMP_CODE = :comp_code
       ORDER BY COST_NAME`,
      { comp_code: cc },
      comp_uid
    );
    return (rows || []).map((r) => ({
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      cost_name: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
      COST_CODE: normCode(r.COST_CODE ?? r.cost_code),
      COST_NAME: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
    }));
  }

  function registerRoutes(app) {
    app.get('/api/goods-inward/context', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const ctx = await fetchInwardDefContext(comp_code, comp_uid);
        res.json({ ok: true, ...ctx });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/po-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, code, bk_code } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const data = await fetchInwardPoHelp(comp_code, comp_uid, { code, bk_code });
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/cost-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const rows = await fetchInwardCostHelp(comp_code, comp_uid);
        res.json({ ok: true, rows });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/user-permissions', async (req, res) => {
      try {
        const { user_name } = req.query;
        if (!user_name) return res.status(400).json({ error: 'user_name is required' });
        const data = await fetchInwardUserPermissions(String(user_name));
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const bill_no = await fetchNextBillNo(comp_code, comp_uid);
        res.json({ ok: true, bill_no, type: INWARD_TYPE });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sdt, edt, party } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const rows = await listGoodsInward(comp_code, comp_uid, { sdt, edt, party });
        res.json(rows);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/print-batch', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sbno, ebno, rtype } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const data = await fetchInwardPrintBatch(comp_code, comp_uid, { sbno, ebno, rtype: rtype || INWARD_TYPE });
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/checklist', async (req, res) => {
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
          god_code,
          pending_only,
          rtype,
        } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const data = await fetchInwardChecklist(comp_code, comp_uid, {
          sdt,
          edt,
          sbno,
          ebno,
          code,
          bk_code,
          item_code,
          god_code,
          pending_only,
          rtype: rtype || INWARD_TYPE,
        });
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward/nav', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, bill_no, bill_date, dir } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const data = await navigateGoodsInward(comp_code, comp_uid, bill_no, bill_date, dir);
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/goods-inward', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, bill_no, bill_date } = req.query;
        if (!comp_code || !bill_no) return res.status(400).json({ error: 'comp_code and bill_no are required' });
        await assertInwardPermission(user_name, comp_uid, 'access');
        const data = await loadGoodsInward(comp_code, comp_uid, bill_no, bill_date);
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/api/goods-inward', async (req, res) => {
      try {
        const { comp_code, comp_year, comp_uid } = req.body || {};
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const data = await saveGoodsInward(comp_code, comp_year, comp_uid, req.body, req);
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.delete('/api/goods-inward', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, bill_no } = req.query;
        if (!comp_code || !bill_no) return res.status(400).json({ error: 'comp_code and bill_no are required' });
        const data = await deleteGoodsInward(comp_code, comp_uid, bill_no, user_name);
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  }

  return {
    registerRoutes,
    loadGoodsInward,
    saveGoodsInward,
    deleteGoodsInward,
    fetchNextBillNo,
    listGoodsInward,
    navigateGoodsInward,
  };
}

module.exports = { createGoodsInward, INWARD_TYPE };
