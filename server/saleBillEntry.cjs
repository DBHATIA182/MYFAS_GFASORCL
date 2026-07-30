/**
 * Sale Bill (tax invoice) entry — VFP DO FORM &G_SALE_FORM WITH 'SL' → SALE.TYPE = 'SL'.
 * Rights: USERS.F1 (access/add/edit/delete) — user master label "Sale" (SRC/data/userMasterModules.js).
 * VFP source: forms/sale.scx + forms/sale_gst.scx (GST grid config in SALEFORM_GST, reused from
 * the existing /api/sale-form-gst endpoints in server.cjs).
 */

'use strict';

const SL_TYPE = 'SL';
const SALE_BILL_MAX_WEIGHT = 9999999999.999;
const SALE_BILL_MAX_CHARGE = 9999999999.99;

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

function normStatus(v) {
  const s = String(v ?? 'B').trim().toUpperCase().slice(0, 1);
  return ['B', 'K', 'H'].includes(s) ? s : 'B';
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

function clampWeight(n) {
  const x = Math.max(0, Math.min(SALE_BILL_MAX_WEIGHT, num(n)));
  return Math.round(x * 1000) / 1000;
}

function clampCharge(n) {
  const x = Math.max(0, Math.min(SALE_BILL_MAX_CHARGE, num(n)));
  return Math.round(x * 100) / 100;
}

function clampSigned(n) {
  const x = Math.max(-SALE_BILL_MAX_CHARGE, Math.min(SALE_BILL_MAX_CHARGE, num(n)));
  return Math.round(x * 100) / 100;
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

function rowValueCI(row, logicalName) {
  if (!row || logicalName == null) return null;
  const want = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase() === want) return row[k];
  }
  return null;
}

function resolveUserName(body, req) {
  const b = body && typeof body === 'object' ? body : {};
  const q = req?.query && typeof req.query === 'object' ? req.query : {};
  return String(b.user_name ?? b.USER_NAME ?? q.user_name ?? q.USER_NAME ?? req?.user?.name ?? '').trim();
}

function int6(n) {
  const x = Math.floor(num(n));
  if (!Number.isFinite(x) || x <= 0) return null;
  return Math.min(999999, x);
}

/** VFP: G_FIN_YEAR = yy(start) || yy(end) from COMPDET.COMP_S_DT / COMP_E_DT (e.g. 2526). */
function computeGFinYear(compdet) {
  if (!compdet) return '';
  const s = compdet instanceof Date ? null : rowValueCI(compdet, 'comp_s_dt');
  const e = compdet instanceof Date ? null : rowValueCI(compdet, 'comp_e_dt');
  const sdt = s instanceof Date && !Number.isNaN(s.getTime()) ? s : null;
  const edt = e instanceof Date && !Number.isNaN(e.getTime()) ? e : null;
  if (!sdt || !edt) return '';
  const y1 = sdt.getFullYear() % 100;
  const y2 = edt.getFullYear() % 100;
  return String(y1).padStart(2, '0') + String(y2).padStart(2, '0');
}

/**
 * Fox-style SALE_INV_NO: SALE_B_TYPE.SALE_BILL_INIT, else DEFVALUE.SALE_BILL_INIT + fin-year, else
 * plain bill no (optionally FY-prefixed when FIN_YEAR_YN = 'Y').
 */
function computeSaleInvNo({ b_type, billNoInt, initBt, initDef, gFinYear, finYearYn }) {
  const bt = String(b_type ?? 'N').trim() || 'N';
  const bn = Number(billNoInt);
  const billPart = Number.isFinite(bn) ? String(Math.trunc(bn)).padStart(6, '0').replace(/^0+(?=\d)/, '') : String(bn);
  const ib = initBt != null ? String(initBt).trim() : '';
  if (ib) return `${ib}${billPart}`;
  const id = initDef != null ? String(initDef).trim() : '';
  if (id) return `${id}${String(gFinYear || '').trim()}${billPart}`;
  if (String(finYearYn || '').trim().toUpperCase() === 'Y') {
    return `${bt}-${String(gFinYear || '').trim()}-${String(Math.trunc(bn))}`;
  }
  return String(Math.trunc(bn));
}

function createSaleBillEntry({ runQuery, parseDateOnly, withCompTransaction, runHubQuery, fetchSaleFormGstRows }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createSaleBillEntry requires runQuery and parseDateOnly');
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

  // ---------------------------------------------------------------------
  // Permissions — USERS.F1 (see SRC/data/userMasterModules.js: F1 = 'Sale').
  // ---------------------------------------------------------------------
  async function fetchSaleUserF1String(user_name) {
    const u = String(user_name || '').trim().toUpperCase();
    if (!u) return { f1: '', source: 'empty_user' };
    const tables = ['GRAINFAS.USERS', 'USERS'];
    for (const t of tables) {
      try {
        const rows = await queryHub(
          `SELECT F1 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
          { u },
          { suppressDbErrorLog: true }
        );
        if (rows?.length) {
          const raw = rows[0].F1 ?? rows[0].f1;
          return { f1: raw != null ? String(raw).trim() : '', source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* ignore optional schema/table */
        }
      }
    }
    return { f1: '', source: 'none' };
  }

  function salePermissionsFromF1(f1) {
    const str = String(f1 ?? '').trim();
    const padded = (str || '0000').padEnd(4, '0').slice(0, 4);
    const bit = (i) => padded.charAt(i) === '1';
    return {
      canOpen: bit(0),
      canAdd: bit(1),
      canEdit: bit(2),
      canDelete: bit(3),
      flags: 'f1',
    };
  }

  async function fetchSaleUserPermissions(user_name) {
    const { f1, source } = await fetchSaleUserF1String(user_name);
    return { f1, source, ...salePermissionsFromF1(f1) };
  }

  async function assertSalePermission(user_name, kind) {
    const perms = await fetchSaleUserPermissions(user_name);
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

  // ---------------------------------------------------------------------
  // DEFVALUE-driven globals (company-wide; GFASORCL keeps these on DEFVALUE,
  // not per-year COMPDET like some sibling installs).
  // ---------------------------------------------------------------------
  async function fetchDefvalueCol(comp_code, comp_uid, col, fallback) {
    try {
      const rows = await runQuery(
        `SELECT NVL(${col}, :fallback) AS V FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0, fallback },
        comp_uid,
        { suppressDbErrorLog: true }
      );
      const v = rows?.[0]?.V ?? rows?.[0]?.v;
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  async function fetchSaleDefFlags(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    // Fast path: one round trip. Falls back to per-column safe reads when any column is missing.
    try {
      const rows = await runQuery(
        `SELECT NVL(WGT_K_Q, 'K') AS WGT_K_Q,
                NVL(SALE_ORDER_TYPE, 'B') AS SALE_ORDER_TYPE,
                NVL(RATE_CHK, 'N') AS RATE_CHK,
                NVL(MARKA_CHK_IN_DISP_CHALLAN, 'N') AS MARKA_CHK_IN_DISP_CHALLAN,
                NVL(SO_CODE_BROKER, ' ') AS SO_CODE_BROKER,
                NVL(FIN_YEAR_YN, 'N') AS FIN_YEAR_YN,
                NVL(BROK_TRF, 'Y') AS BROK_TRF,
                NVL(DEF_DAYS, 0) AS DEF_DAYS,
                NVL(ROUNDOFF, 'N') AS ROUNDOFF,
                NVL(LABCD, 0) AS LABCD,
                NVL(FGTCD, 0) AS FGTCD,
                NVL(INS_CODE, 0) AS INS_CODE,
                NVL(DALALI_CODE, 0) AS DALALI_CODE,
                NVL(ROFF_CODE, 0) AS ROFF_CODE,
                NVL(CGST_CODE, 0) AS CGST_CODE,
                NVL(SGST_CODE, 0) AS SGST_CODE,
                NVL(IGST_CODE, 0) AS IGST_CODE,
                NVL(TDS_CODE, 0) AS TDS_CODE,
                NVL(SALE_BILL_INIT, ' ') AS SALE_BILL_INIT
         FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: cc },
        comp_uid,
        { suppressDbErrorLog: true }
      );
      const r = rows?.[0];
      if (!r) throw new Error('no defvalue row');
      const yn = (v, d = 'N') => (String(v ?? d).trim().toUpperCase() === 'Y' ? 'Y' : 'N');
      const wgtRaw = String(r.WGT_K_Q ?? r.wgt_k_q ?? 'K').trim().toUpperCase().slice(0, 1) || 'K';
      const [negStock, negStockQw, daneLessPaploo] = await Promise.all([
        fetchDefvalueCol(cc, comp_uid, 'NEG_STOCK', 'N'),
        fetchDefvalueCol(cc, comp_uid, 'NEG_STOCK_QW', 'Q'),
        fetchDefvalueCol(cc, comp_uid, 'DANE_LESS_PAPLOO', 'N'),
      ]);
      return {
        wgt_kq: ['K', 'Q', 'X', 'W'].includes(wgtRaw) ? wgtRaw : 'K',
        sale_order_type: String(r.SALE_ORDER_TYPE ?? r.sale_order_type ?? 'B').trim().toUpperCase() === 'C' ? 'C' : 'B',
        rate_chk: yn(r.RATE_CHK ?? r.rate_chk),
        marka_chk_in_disp_challan: yn(r.MARKA_CHK_IN_DISP_CHALLAN ?? r.marka_chk_in_disp_challan),
        so_code_broker: String(r.SO_CODE_BROKER ?? r.so_code_broker ?? '').trim().toUpperCase(),
        fin_year_yn: yn(r.FIN_YEAR_YN ?? r.fin_year_yn),
        brok_trf: yn(r.BROK_TRF ?? r.brok_trf, 'Y'),
        def_days: num(r.DEF_DAYS ?? r.def_days),
        roundoff: yn(r.ROUNDOFF ?? r.roundoff),
        labcd: num(r.LABCD ?? r.labcd) || null,
        fgtcd: num(r.FGTCD ?? r.fgtcd) || null,
        ins_code: num(r.INS_CODE ?? r.ins_code) || null,
        dalali_code: num(r.DALALI_CODE ?? r.dalali_code) || null,
        roff_code: num(r.ROFF_CODE ?? r.roff_code) || null,
        cgst_code: num(r.CGST_CODE ?? r.cgst_code) || null,
        sgst_code: num(r.SGST_CODE ?? r.sgst_code) || null,
        igst_code: num(r.IGST_CODE ?? r.igst_code) || null,
        tds_code: num(r.TDS_CODE ?? r.tds_code) || null,
        sale_bill_init: String(r.SALE_BILL_INIT ?? r.sale_bill_init ?? '').trim(),
        neg_stock: yn(negStock),
        neg_stock_qw: String(negStockQw ?? 'Q').trim().toUpperCase() === 'W' ? 'W' : 'Q',
        dane_less_paploo: yn(daneLessPaploo),
      };
    } catch (err) {
      if (!isLoginOptionalTableError(err)) {
        /* fall through to minimal defaults below */
      }
      // Minimal, individually-safe fallback (only the columns already proven to exist elsewhere).
      const [wgt_kq, sale_order_type, cgst_code, sgst_code, igst_code, neg_stock, neg_stock_qw, dane_less_paploo] = await Promise.all([
        fetchDefvalueCol(cc, comp_uid, 'WGT_K_Q', 'K'),
        fetchDefvalueCol(cc, comp_uid, 'SALE_ORDER_TYPE', 'B'),
        fetchDefvalueCol(cc, comp_uid, 'CGST_CODE', 0),
        fetchDefvalueCol(cc, comp_uid, 'SGST_CODE', 0),
        fetchDefvalueCol(cc, comp_uid, 'IGST_CODE', 0),
        fetchDefvalueCol(cc, comp_uid, 'NEG_STOCK', 'N'),
        fetchDefvalueCol(cc, comp_uid, 'NEG_STOCK_QW', 'Q'),
        fetchDefvalueCol(cc, comp_uid, 'DANE_LESS_PAPLOO', 'N'),
      ]);
      const wgtRaw = String(wgt_kq).trim().toUpperCase().slice(0, 1) || 'K';
      return {
        wgt_kq: ['K', 'Q', 'X', 'W'].includes(wgtRaw) ? wgtRaw : 'K',
        sale_order_type: String(sale_order_type).trim().toUpperCase() === 'C' ? 'C' : 'B',
        rate_chk: 'N',
        marka_chk_in_disp_challan: 'N',
        so_code_broker: '',
        fin_year_yn: 'N',
        brok_trf: 'Y',
        def_days: 0,
        roundoff: 'N',
        labcd: null,
        fgtcd: null,
        ins_code: null,
        dalali_code: null,
        roff_code: null,
        cgst_code: num(cgst_code) || null,
        sgst_code: num(sgst_code) || null,
        igst_code: num(igst_code) || null,
        tds_code: null,
        sale_bill_init: '',
        neg_stock: String(neg_stock ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
        neg_stock_qw: String(neg_stock_qw ?? 'Q').trim().toUpperCase() === 'W' ? 'W' : 'Q',
        dane_less_paploo: String(dane_less_paploo ?? 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
      };
    }
  }

  /** VFP SALE_B_TYPE — per-branch bill-no prefix override, when the table exists. */
  async function fetchSaleBillTypeInit(comp_code, b_type, comp_uid) {
    const cc = Number(comp_code) || 0;
    const bt = String(b_type ?? 'N').trim() || ' ';
    try {
      const rows = await runQuery(
        `SELECT SALE_BILL_INIT FROM SALE_B_TYPE
         WHERE COMP_CODE = :comp_code AND NVL(TRIM(GOD_B_TYPE), ' ') = NVL(TRIM(:b_type), ' ')
           AND ROWNUM = 1`,
        { comp_code: cc, b_type: bt },
        comp_uid,
        { suppressDbErrorLog: true }
      );
      const v = rows?.[0]?.SALE_BILL_INIT ?? rows?.[0]?.sale_bill_init;
      return v != null ? String(v).trim() : '';
    } catch {
      return '';
    }
  }

  // ---------------------------------------------------------------------
  // COMPDET (financial-year window + company display fields).
  // ---------------------------------------------------------------------
  async function fetchCompdetRow(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const cu = String(comp_uid ?? '').trim();
    const sqlExact = `SELECT * FROM compdet WHERE comp_code = :comp_code AND TRIM(TO_CHAR(comp_uid)) = :comp_uid`;
    const sqlLatest = `SELECT * FROM (SELECT * FROM compdet WHERE comp_code = :comp_code ORDER BY comp_year DESC NULLS LAST) WHERE ROWNUM = 1`;
    const schemas = [comp_uid, null];
    for (const schema of schemas) {
      try {
        const rows = await runQuery(sqlExact, { comp_code: cc, comp_uid: cu }, schema, { suppressDbErrorLog: true });
        if (rows?.[0]) return rows[0];
      } catch (err) {
        if (!isLoginOptionalTableError(err)) throw err;
      }
      try {
        const rows = await runQuery(sqlLatest, { comp_code: cc }, schema, { suppressDbErrorLog: true });
        if (rows?.[0]) return rows[0];
      } catch (err) {
        if (!isLoginOptionalTableError(err)) throw err;
      }
    }
    return null;
  }

  function assertBillDateInFinancialYear(billDateDmy, compdet) {
    const inv = parseDateOnly(billDateDmy);
    if (!inv) return { ok: false, error: 'Invalid bill_date (use DD-MM-YYYY).' };
    if (!compdet) return { ok: true };
    const s = parseDateOnly(rowValueCI(compdet, 'comp_s_dt'));
    const e = parseDateOnly(rowValueCI(compdet, 'comp_e_dt'));
    if (!s || !e) return { ok: true };
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (day(inv) < day(s) || day(inv) > day(e)) {
      const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
      return { ok: false, error: `Bill date must be between ${fmt(s)} and ${fmt(e)} (financial year).` };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------
  // Context — DEFVALUE flags + SALEFORM_GST grid config (requirement #2).
  // ---------------------------------------------------------------------
  async function fetchContext(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const [flags, compdet, gstRows] = await Promise.all([
      fetchSaleDefFlags(cc, comp_uid),
      fetchCompdetRow(cc, comp_uid),
      typeof fetchSaleFormGstRows === 'function'
        ? fetchSaleFormGstRows('SALE', comp_uid).catch(() => [])
        : Promise.resolve([]),
    ]);
    const gFinYear = computeGFinYear(compdet);
    const gridColumns = (gstRows || [])
      .filter((r) => Number(r.s_no ?? r.S_NO ?? 0) > 0)
      .map((r) => ({
        f_name: String(r.f_name ?? r.F_NAME ?? '').trim().toUpperCase(),
        F_NAME: String(r.f_name ?? r.F_NAME ?? '').trim().toUpperCase(),
        hide_col: String(r.hide_col ?? r.HIDE_COL ?? 'N').trim().toUpperCase() || 'N',
        HIDE_COL: String(r.hide_col ?? r.HIDE_COL ?? 'N').trim().toUpperCase() || 'N',
        s_no: Number(r.s_no ?? r.S_NO ?? 0) || 0,
        S_NO: Number(r.s_no ?? r.S_NO ?? 0) || 0,
      }))
      .sort((a, b) => Number(a.s_no) - Number(b.s_no));
    const headerFields = (gstRows || [])
      .filter((r) => Number(r.s_no ?? r.S_NO ?? 0) === 0)
      .map((r) => ({
        f_name: String(r.f_name ?? r.F_NAME ?? '').trim().toUpperCase(),
        F_NAME: String(r.f_name ?? r.F_NAME ?? '').trim().toUpperCase(),
        add_yn: String(r.add_yn ?? r.ADD_YN ?? 'Y').trim().toUpperCase() || 'Y',
        edit_yn: String(r.edit_yn ?? r.EDIT_YN ?? 'Y').trim().toUpperCase() || 'Y',
        hide_col: String(r.hide_col ?? r.HIDE_COL ?? 'N').trim().toUpperCase() || 'N',
        HIDE_COL: String(r.hide_col ?? r.HIDE_COL ?? 'N').trim().toUpperCase() || 'N',
      }));
    return {
      ok: true,
      G_WGTKQ: flags.wgt_kq,
      G_SALE_ORDER_TYPE: flags.sale_order_type,
      G_RATE_CHK: flags.rate_chk,
      G_MARKA_CHK_IN_DISP_CHALLAN: flags.marka_chk_in_disp_challan,
      G_SO_CODE_BROKER: flags.so_code_broker,
      G_FIN_YEAR_YN: flags.fin_year_yn,
      G_BROK_TRF: flags.brok_trf,
      G_DEF_DAYS: flags.def_days,
      G_ROUNDOFF: flags.roundoff,
      G_LABCD: flags.labcd,
      G_FGTCD: flags.fgtcd,
      G_INS_CODE: flags.ins_code,
      G_DALALI_CODE: flags.dalali_code,
      G_ROFF_CODE: flags.roff_code,
      G_CGST_CODE: flags.cgst_code,
      G_SGST_CODE: flags.sgst_code,
      G_IGST_CODE: flags.igst_code,
      G_TDS_CODE: flags.tds_code,
      G_SALE_BILL_INIT: flags.sale_bill_init,
      G_NEG_STOCK: flags.neg_stock,
      G_NEG_STOCK_QW: flags.neg_stock_qw,
      neg_stock: flags.neg_stock,
      neg_stock_qw: flags.neg_stock_qw,
      G_DANE_LESS_PAPLOO: flags.dane_less_paploo,
      dane_less_paploo: flags.dane_less_paploo,
      wgt_kq: flags.wgt_kq,
      G_FIN_YEAR: gFinYear,
      COMP_S_DT: formatDateOut(rowValueCI(compdet, 'comp_s_dt')),
      COMP_E_DT: formatDateOut(rowValueCI(compdet, 'comp_e_dt')),
      grid_columns: gridColumns,
      header_fields: headerFields,
    };
  }

  // ---------------------------------------------------------------------
  // Lookups. Schemas differ per install, so column lists are probed once and cached.
  // ---------------------------------------------------------------------
  const tableColCache = new Map();

  async function fetchTableColumns(table, comp_uid) {
    const tbl = String(table).toUpperCase();
    const key = `${String(comp_uid ?? '_')}|${tbl}`;
    if (tableColCache.has(key)) return tableColCache.get(key);
    const rows = await runQuery(
      `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tbl`,
      { tbl },
      comp_uid,
      { suppressDbErrorLog: true }
    ).catch(() => []);
    const cols = new Set(
      (rows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').trim().toUpperCase())
    );
    tableColCache.set(key, cols);
    return cols;
  }

  async function fetchLookups(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const markaSql = `SELECT DISTINCT TRIM(MARKA) AS MARKA FROM MARKA WHERE COMP_CODE = :comp_code ORDER BY 1`;
    const plantSql = `SELECT PLANT_CODE, PLANT_NAME FROM PLANT WHERE COMP_CODE = :comp_code ORDER BY PLANT_CODE`;

    const itemCols = await fetchTableColumns('ITEMMAST', comp_uid);
    const hasCol = (c) => itemCols.size === 0 || itemCols.has(String(c).toUpperCase());
    const numCol = (c, alias = c) => (hasCol(c) ? `NVL(${c}, 0) AS ${alias}` : `0 AS ${alias}`);
    const txtCol = (c, alias = c) => (hasCol(c) ? `TRIM(NVL(${c}, ' ')) AS ${alias}` : `' ' AS ${alias}`);
    // PACKING drives qty×packing weight; some schemas name the unit weight UNIT_WGT instead.
    const packingExpr = hasCol('PACKING')
      ? 'NVL(PACKING, 0) AS PACKING'
      : hasCol('UNIT_WGT')
        ? 'NVL(UNIT_WGT, 0) AS PACKING'
        : '0 AS PACKING';
    const itemSql = `
      SELECT ITEM_CODE, ITEM_NAME,
             ${numCol('TAX_PER')},
             ${numCol('BK_RATE')},
             ${numCol('S_RATE')},
             ${numCol('COMMISSION')},
             ${numCol('BROKERAGE')},
             ${packingExpr},
             ${txtCol('UNIT_TYPE')},
             ${hasCol('AMT_CAL') ? "TRIM(NVL(AMT_CAL, 'W')) AS AMT_CAL" : "'W' AS AMT_CAL"},
             ${hasCol('S_CODE') ? 'S_CODE' : "'' AS S_CODE"}
      FROM ITEMMAST
      WHERE COMP_CODE = :comp_code
      ORDER BY ITEM_NAME`;

    const [markas, plants, items] = await Promise.all([
      runQuery(markaSql, { comp_code: cc }, comp_uid, { suppressDbErrorLog: true }).catch(() => []),
      runQuery(plantSql, { comp_code: cc }, comp_uid, { suppressDbErrorLog: true }).catch(() => []),
      runQuery(itemSql, { comp_code: cc }, comp_uid, { suppressDbErrorLog: true }).catch(() => []),
    ]);
    return { markas: markas || [], plants: plants || [], items: items || [] };
  }

  // ---------------------------------------------------------------------
  // Next bill no / invoice-no preview.
  // ---------------------------------------------------------------------
  async function fetchNextBillNo(comp_code, comp_uid, type, b_type) {
    const cc = Number(comp_code) || 0;
    const t = String(type ?? SL_TYPE).trim().toUpperCase();
    const bt = String(b_type ?? 'N').trim() || 'N';
    const rows = await runQuery(
      `SELECT NVL(MAX(BILL_NO), 0) + 1 AS NEXT_NO FROM SALE
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
         AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
      { comp_code: cc, type: t, b_type: bt },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  async function fetchInvNoPreview(comp_code, comp_uid, { type, b_type, bill_no } = {}) {
    const cc = Number(comp_code) || 0;
    const bt = String(b_type ?? 'N').trim() || 'N';
    const [compdet, flags, initBt] = await Promise.all([
      fetchCompdetRow(cc, comp_uid),
      fetchSaleDefFlags(cc, comp_uid),
      fetchSaleBillTypeInit(cc, bt, comp_uid),
    ]);
    const gFinYear = computeGFinYear(compdet);
    const sale_inv_no = computeSaleInvNo({
      b_type: bt,
      billNoInt: Number(bill_no),
      initBt,
      initDef: flags.sale_bill_init,
      gFinYear,
      finYearYn: flags.fin_year_yn,
    });
    return { sale_inv_no };
  }

  // ---------------------------------------------------------------------
  // Pending dispatch challans (DC/DR balance not yet billed) — help for sale bill lines.
  // ---------------------------------------------------------------------
  async function fetchPendingChallans(comp_code, comp_uid, { code, bk_code } = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc };
    let extra = '';
    const partyCode = normCode(code);
    if (partyCode) {
      binds.code = partyCode;
      extra += ' AND TRIM(A.CODE) = TRIM(:code)';
    }
    const brokerCode = normCode(bk_code);
    if (brokerCode) {
      binds.bk_code = brokerCode;
      extra += " AND TRIM(NVL(A.BK_CODE, ' ')) = TRIM(:bk_code)";
    }
    const sql = `
      SELECT
        TRIM(TO_CHAR(A.CH_NO)) AS CH_NO,
        TRIM(A.CODE) AS CODE,
        C.NAME AS PARTY_NAME,
        A.ITEM_CODE,
        B.ITEM_NAME,
        TRIM(TO_CHAR(NVL(A.LOT, 0))) AS LOT,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        TRIM(NVL(A.GOD_CODE, ' ')) AS GOD_CODE,
        MAX(A.RATE) AS RATE,
        SUM(CASE WHEN TRIM(A.TYPE) = 'DC' THEN NVL(A.QNTY, 0)
                 WHEN TRIM(A.TYPE) = 'DR' THEN -NVL(A.QNTY, 0) ELSE 0 END) AS DC_QNTY,
        SUM(CASE WHEN TRIM(A.TYPE) IN ('SL', 'SE', 'CN')
                 THEN CASE WHEN TRIM(A.TYPE) = 'CN' THEN -NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) END
                 ELSE 0 END) AS BILLED_QNTY,
        SUM(CASE WHEN TRIM(A.TYPE) = 'DC' THEN NVL(A.WEIGHT, 0)
                 WHEN TRIM(A.TYPE) = 'DR' THEN -NVL(A.WEIGHT, 0) ELSE 0 END) AS DC_WEIGHT,
        SUM(CASE WHEN TRIM(A.TYPE) IN ('SL', 'SE', 'CN')
                 THEN CASE WHEN TRIM(A.TYPE) = 'CN' THEN -NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) END
                 ELSE 0 END) AS BILLED_WEIGHT
      FROM SALE A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.CODE) = TRIM(C.CODE)
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) IN ('DC', 'DR', 'SL', 'SE', 'CN')
        AND NVL(A.CH_NO, 0) <> 0
        ${extra}
      GROUP BY TRIM(TO_CHAR(A.CH_NO)), TRIM(A.CODE), C.NAME, A.ITEM_CODE, B.ITEM_NAME,
               TRIM(TO_CHAR(NVL(A.LOT, 0))), TRIM(NVL(A.STATUS, 'B')), TRIM(NVL(A.GOD_CODE, ' '))
      HAVING SUM(CASE WHEN TRIM(A.TYPE) = 'DC' THEN NVL(A.QNTY, 0)
                      WHEN TRIM(A.TYPE) = 'DR' THEN -NVL(A.QNTY, 0) ELSE 0 END)
           - SUM(CASE WHEN TRIM(A.TYPE) IN ('SL', 'SE', 'CN')
                      THEN CASE WHEN TRIM(A.TYPE) = 'CN' THEN -NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) END
                      ELSE 0 END) > 0
      ORDER BY 1, 4`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r) => {
      const dcQ = num(r.DC_QNTY ?? r.dc_qnty);
      const billedQ = num(r.BILLED_QNTY ?? r.billed_qnty);
      const dcW = num(r.DC_WEIGHT ?? r.dc_weight);
      const billedW = num(r.BILLED_WEIGHT ?? r.billed_weight);
      return {
        ch_no: String(r.CH_NO ?? r.ch_no ?? '').trim(),
        code: normCode(r.CODE ?? r.code),
        party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        lot: String(r.LOT ?? r.lot ?? '').trim(),
        status: normStatus(r.STATUS ?? r.status),
        god_code: normCode(r.GOD_CODE ?? r.god_code),
        rate: num(r.RATE ?? r.rate),
        dc_qnty: dcQ,
        billed_qnty: billedQ,
        bal_qnty: Math.round((dcQ - billedQ) * 1000) / 1000,
        dc_weight: dcW,
        billed_weight: billedW,
        bal_weight: Math.round((dcW - billedW) * 1000) / 1000,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Pending sales orders (SORDER balance not yet billed) — help for sale bill lines.
  // ---------------------------------------------------------------------
  async function fetchPendingOrders(comp_code, comp_uid, { code, bk_code, item_code } = {}) {
    const cc = Number(comp_code) || 0;
    const flags = await fetchSaleDefFlags(cc, comp_uid);
    const masterColumn = flags.sale_order_type === 'C' ? 'CODE' : 'BK_CODE';
    const masterCodeVal = masterColumn === 'CODE' ? normCode(code) : normCode(bk_code || code);
    if (!masterCodeVal) return [];
    const binds = { comp_code: cc, master_code: masterCodeVal };
    let itemExtra = '';
    const ic = Number(item_code) || 0;
    if (ic) {
      binds.item_code = ic;
      itemExtra = ' AND A.ITEM_CODE = :item_code';
    }

    const orderRows = await runQuery(
      `SELECT A.SO_NO, MAX(A.SO_DATE) AS SO_DATE, A.ITEM_CODE, MAX(B.ITEM_NAME) AS ITEM_NAME,
              TRIM(NVL(A.STATUS, 'B')) AS STATUS, MAX(NVL(A.RATE, 0)) AS RATE,
              SUM(NVL(A.QNTY, 0)) AS SOQTY, SUM(NVL(A.WEIGHT, 0)) AS SOWGT
       FROM SORDER A
       JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) = 'SO'
         AND TRIM(A.${masterColumn}) = TRIM(:master_code)
         AND NVL(A.CLEAR_YN, 'N') <> 'Y'
         ${itemExtra}
       GROUP BY A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B'))
       ORDER BY A.SO_NO`,
      binds,
      comp_uid
    );

    const usedRows = await runQuery(
      `SELECT A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B')) AS STATUS,
              SUM(CASE WHEN TRIM(A.TYPE) = 'CN' THEN -NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) END) AS SLQTY,
              SUM(CASE WHEN TRIM(A.TYPE) = 'CN' THEN -NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) END) AS SLWGT
       FROM SALE A
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.${masterColumn}) = TRIM(:master_code)
         AND TRIM(A.TYPE) IN ('SL', 'SE', 'CN')
         AND NVL(A.SO_NO, 0) <> 0
         ${itemExtra}
       GROUP BY A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B'))`,
      binds,
      comp_uid
    );

    const keyFor = (row) =>
      `${String(row.SO_NO ?? row.so_no ?? '').trim()}|${Number(row.ITEM_CODE ?? row.item_code ?? 0) || 0}|${normStatus(row.STATUS ?? row.status)}`;
    const used = new Map((usedRows || []).map((row) => [keyFor(row), row]));

    return (orderRows || [])
      .map((row, idx) => {
        const consumed = used.get(keyFor(row)) || {};
        const soQty = num(row.SOQTY ?? row.soqty);
        const soWeight = num(row.SOWGT ?? row.sowgt);
        const usedQty = num(consumed.SLQTY ?? consumed.slqty);
        const usedWeight = num(consumed.SLWGT ?? consumed.slwgt);
        return {
          _id: `${keyFor(row)}-${idx}`,
          so_no: Number(row.SO_NO ?? row.so_no ?? 0) || 0,
          so_date: formatDateOut(row.SO_DATE ?? row.so_date),
          item_code: Number(row.ITEM_CODE ?? row.item_code ?? 0) || 0,
          item_name: String(row.ITEM_NAME ?? row.item_name ?? '').trim(),
          status: normStatus(row.STATUS ?? row.status),
          rate: num(row.RATE ?? row.rate),
          order_qnty: soQty,
          used_qnty: usedQty,
          balance_qnty: Math.round((soQty - usedQty) * 1000) / 1000,
          order_weight: soWeight,
          used_weight: usedWeight,
          balance_weight: Math.round((soWeight - usedWeight) * 1000) / 1000,
        };
      })
      .filter((row) => row.so_no >= 1 && (row.balance_qnty > 0 || row.balance_weight > 0));
  }

  // ---------------------------------------------------------------------
  // Master / item validation.
  // ---------------------------------------------------------------------
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
    return row;
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
      `SELECT ITEM_CODE FROM ITEMMAST WHERE COMP_CODE = :comp_code AND ITEM_CODE = :item_code`,
      { comp_code: cc, item_code: ic },
      comp_uid
    );
    if (!rows?.[0]) {
      const err = new Error(`Item ${ic} not found in item master.`);
      err.status = 400;
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Load / list / nav.
  // ---------------------------------------------------------------------
  async function loadSaleBill(comp_code, comp_uid, type, bill_no, b_type) {
    const cc = Number(comp_code) || 0;
    const t = String(type ?? SL_TYPE).trim().toUpperCase() || SL_TYPE;
    const no = Number(bill_no) || 0;
    if (!no) {
      const err = new Error('Bill number is required.');
      err.status = 400;
      throw err;
    }
    const bt = String(b_type ?? 'N').trim() || 'N';
    const sql = `
      SELECT
        A.*,
        B.ITEM_NAME,
        NVL(B.ITEM_HEAD, ' ') AS HSN_CODE,
        C.NAME AS PARTY_NAME,
        NVL(C.ADD1, ' ') AS PARTY_ADD1,
        NVL(C.ADD2, ' ') AS PARTY_ADD2,
        NVL(C.ADD3, ' ') AS PARTY_ADD3,
        C.CITY AS PARTY_CITY,
        NVL(C.GST_NO, ' ') AS PARTY_GST,
        NVL(C.PAN, ' ') AS PARTY_PAN,
        NVL(C.STATE, ' ') AS PARTY_STATE,
        NVL(C.STATE_CODE, ' ') AS PARTY_STATE_CODE,
        TRIM(NVL(C.L_C, 'L')) AS PARTY_L_C,
        D.NAME AS BK_NAME,
        G.GOD_NAME
      FROM SALE A
      LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.CODE) = TRIM(C.CODE)
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.BK_CODE) = TRIM(D.CODE)
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND TRIM(A.GOD_CODE) = TRIM(G.GOD_CODE)
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND A.BILL_NO = :bill_no
        AND NVL(TRIM(A.B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')
      ORDER BY A.TRN_NO`;
    const rows = await runQuery(sql, { comp_code: cc, type: t, bill_no: no, b_type: bt }, comp_uid);
    if (!rows?.length) {
      const err = new Error(`Sale Bill ${no} not found.`);
      err.status = 404;
      throw err;
    }
    const h = rows[0];
    const header = {
      type: t,
      bill_no: Number(h.BILL_NO ?? h.bill_no ?? 0) || no,
      b_type: String(h.B_TYPE ?? h.b_type ?? 'N').trim() || 'N',
      bill_date: formatDateOut(h.BILL_DATE ?? h.bill_date),
      v_date: formatDateOut(h.V_DATE ?? h.v_date),
      sale_inv_no: String(h.SALE_INV_NO ?? h.sale_inv_no ?? '').trim(),
      code: normCode(h.CODE ?? h.code),
      party_name: String(h.PARTY_NAME ?? h.party_name ?? '').trim(),
      party_add1: String(h.PARTY_ADD1 ?? h.party_add1 ?? '').trim(),
      party_add2: String(h.PARTY_ADD2 ?? h.party_add2 ?? '').trim(),
      party_add3: String(h.PARTY_ADD3 ?? h.party_add3 ?? '').trim(),
      party_city: String(h.PARTY_CITY ?? h.party_city ?? '').trim(),
      party_gst: String(h.PARTY_GST ?? h.party_gst ?? '').trim(),
      party_pan: String(h.PARTY_PAN ?? h.party_pan ?? '').trim(),
      party_state: String(h.PARTY_STATE ?? h.party_state ?? '').trim(),
      party_state_code: String(h.PARTY_STATE_CODE ?? h.party_state_code ?? '').trim(),
      l_c: String(h.PARTY_L_C ?? h.party_l_c ?? h.L_C ?? h.l_c ?? 'L').trim().toUpperCase().slice(0, 1) || 'L',
      delv_code: normCode(h.DELV_CODE ?? h.delv_code) || normCode(h.CODE ?? h.code),
      b_code: h.B_CODE ?? h.b_code ?? null,
      bk_name: String(h.BK_NAME ?? h.bk_name ?? '').trim(),
      days: num(h.DAYS ?? h.days),
      truck_no: String(h.TRUCK_NO ?? h.truck_no ?? '').trim(),
      tpt: String(h.TPT ?? h.tpt ?? '').trim(),
      gr_no: String(h.GR_NO ?? h.gr_no ?? '').trim(),
      remarks: String(h.REMARKS ?? h.remarks ?? '').trim(),
      mod_reason: String(h.MOD_REASON ?? h.mod_reason ?? '').trim(),
      int_type: String(h.INT_TYPE ?? h.int_type ?? '').trim().toUpperCase().slice(0, 1),
      bill_amt: num(h.BILL_AMT ?? h.bill_amt),
      labour: num(h.LABOUR ?? h.labour),
      freight: num(h.FREIGHT ?? h.freight),
      ins: num(h.INS ?? h.ins),
      oth_exp: num(h.OTH_EXP ?? h.oth_exp),
      add_code: h.ADD_CODE ?? h.add_code ?? null,
      labour_code: h.LABCD ?? h.labcd ?? null,
      freight_code: h.FGTCD ?? h.fgtcd ?? null,
      ins_code: h.INS_CODE ?? h.ins_code ?? null,
      arh_per: num(h.ARH_PER ?? h.arh_per),
      arh_amt: num(h.ARH_AMT ?? h.arh_amt),
      arh_code: h.ARH_CODE ?? h.arh_code ?? null,
      tds_on_amt: num(h.TDS_ON_AMT ?? h.tds_on_amt),
      tds_per: num(h.TDS_PER ?? h.tds_per),
      tds_amt: num(h.TDS_AMT ?? h.tds_amt),
    };
    for (let i = 1; i <= 10; i += 1) {
      const ek = `OTH_EXP${i}`;
      const ck = `OTH_CD${i}`;
      header[`oth_exp${i}`] = num(h[ek] ?? h[`oth_exp${i}`]);
      const cd = h[ck] ?? h[`oth_cd${i}`];
      header[`oth_cd${i}`] = cd != null && String(cd).trim() !== '' ? String(cd).trim() : '';
    }
    const lines = rows.map((r, idx) => ({
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      hsn_code: String(r.HSN_CODE ?? r.hsn_code ?? '').trim(),
      ch_no: r.CH_NO ?? r.ch_no ?? null,
      ch_type: String(r.CH_TYPE ?? r.ch_type ?? '').trim(),
      so_no: r.SO_NO ?? r.so_no ?? null,
      s_code: normCode(r.S_CODE ?? r.s_code),
      sup_code: normCode(r.S_CODE ?? r.s_code ?? r.SUP_CODE ?? r.sup_code),
      marka: String(r.MARKA ?? r.marka ?? '').trim(),
      plant_code: String(r.PLANT_CODE ?? r.plant_code ?? '').trim(),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      god_name: String(r.GOD_NAME ?? r.god_name ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      lot: r.LOT ?? r.lot ?? '',
      b_no: r.B_NO ?? r.b_no ?? '',
      packing: num(r.PACKING ?? r.packing),
      g_weight: num(r.G_WEIGHT ?? r.g_weight),
      d_weight: num(r.D_WEIGHT ?? r.d_weight),
      qnty: num(r.QNTY ?? r.qnty),
      weight: num(r.WEIGHT ?? r.weight),
      s_rate: num(r.S_RATE ?? r.s_rate),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      comm_per: num(r.COMM_PER ?? r.comm_per),
      brok_per: num(r.BROK_PER ?? r.brok_per),
      dane: String(r.DANE ?? r.dane ?? '').trim().toUpperCase().slice(0, 1),
      dane_wgt: num(r.DANE_WGT ?? r.dane_wgt),
      dane_amt: num(r.DANE_AMT ?? r.dane_amt),
      paploo1: num(r.PAPLOO1 ?? r.paploo1),
      paploo2: num(r.PAPLOO2 ?? r.paploo2),
      paploo3: num(r.PAPLOO3 ?? r.paploo3),
      paploo4: num(r.PAPLOO4 ?? r.paploo4),
      paploo5: num(r.PAPLOO5 ?? r.paploo5),
      p_amt1: num(r.P_AMT1 ?? r.p_amt1),
      p_amt2: num(r.P_AMT2 ?? r.p_amt2),
      p_amt3: num(r.P_AMT3 ?? r.p_amt3),
      p_amt4: num(r.P_AMT4 ?? r.p_amt4),
      p_amt5: num(r.P_AMT5 ?? r.p_amt5),
      cal: Number(r.CAL ?? r.cal ?? 1) || 1,
      e_d: num(r.E_D ?? r.e_d),
      e_damt: num(r.E_DAMT ?? r.e_damt),
      item_cat: String(r.ITEM_CAT ?? r.item_cat ?? '').trim(),
      dis_per: num(r.DIS_PER ?? r.dis_per),
      dis_amt: num(r.DIS_AMT ?? r.dis_amt),
      taxable: num(r.TAXABLE ?? r.taxable),
      cgst_per: num(r.CGST_PER ?? r.cgst_per),
      sgst_per: num(r.SGST_PER ?? r.sgst_per),
      igst_per: num(r.IGST_PER ?? r.igst_per),
      cgst_amt: num(r.CGST_AMT ?? r.cgst_amt),
      sgst_amt: num(r.SGST_AMT ?? r.sgst_amt),
      igst_amt: num(r.IGST_AMT ?? r.igst_amt),
      cost_code: String(r.COST_CODE ?? r.cost_code ?? '').trim(),
      sup_date: formatDateOut(r.SUP_DATE ?? r.sup_date),
      bard_item_code: r.BARD_ITEM_CODE ?? r.bard_item_code ?? '',
      bk_rate: num(r.BK_RATE ?? r.bk_rate),
      bk_bw: String(r.BK_BW ?? r.bk_bw ?? '').trim(),
      bk_amt: num(r.BK_AMT ?? r.bk_amt),
    }));
    return { ok: true, header, lines };
  }

  async function listSaleBills(comp_code, comp_uid, { type, b_type, sdt, edt, party } = {}) {
    const cc = Number(comp_code) || 0;
    const t = String(type ?? SL_TYPE).trim().toUpperCase() || SL_TYPE;
    const binds = { comp_code: cc, type: t };
    let extra = '';
    const bt = b_type != null ? String(b_type).trim() : '';
    if (bt) {
      binds.b_type = bt;
      extra += " AND NVL(TRIM(A.B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')";
    }
    const s = formatDateBind(sdt);
    const e = formatDateBind(edt);
    if (s) {
      binds.sdt = s;
      extra += " AND TRUNC(A.BILL_DATE) >= TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY'))";
    }
    if (e) {
      binds.edt = e;
      extra += " AND TRUNC(A.BILL_DATE) <= TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))";
    }
    const p = normCode(party);
    if (p) {
      binds.party = p;
      extra += ' AND TRIM(A.CODE) = TRIM(:party)';
    }
    const sql = `
      SELECT A.BILL_NO, A.BILL_DATE, A.B_TYPE, A.CODE, B.NAME AS PARTY_NAME, B.CITY AS PARTY_CITY,
             A.TRUCK_NO, MAX(NVL(A.BILL_AMT, 0)) AS BILL_AMT
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND TRIM(A.CODE) = TRIM(B.CODE)
      WHERE A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) ${extra}
      GROUP BY A.BILL_NO, A.BILL_DATE, A.B_TYPE, A.CODE, B.NAME, B.CITY, A.TRUCK_NO
      ORDER BY A.BILL_DATE DESC, A.BILL_NO DESC`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r) => ({
      bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
      bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
      b_type: String(r.B_TYPE ?? r.b_type ?? 'N').trim() || 'N',
      code: normCode(r.CODE ?? r.code),
      party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
      party_city: String(r.PARTY_CITY ?? r.party_city ?? '').trim(),
      truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
      bill_amt: num(r.BILL_AMT ?? r.bill_amt),
    }));
  }

  async function navSaleBill(comp_code, comp_uid, type, b_type, bill_no, direction) {
    const cc = Number(comp_code) || 0;
    const t = String(type ?? SL_TYPE).trim().toUpperCase() || SL_TYPE;
    const bt = String(b_type ?? 'N').trim() || 'N';
    const no = Number(bill_no) || 0;
    const dir = String(direction ?? 'next').trim().toLowerCase();
    const cmp = dir === 'prev' ? '<' : '>';
    const order = dir === 'prev' ? 'DESC' : 'ASC';
    const rows = await runQuery(
      `SELECT MIN(BILL_NO) AS N FROM (
         SELECT DISTINCT BILL_NO FROM SALE
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
           AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')
           AND BILL_NO ${cmp} :bill_no
         ORDER BY BILL_NO ${order}
       ) WHERE ROWNUM <= 1`,
      { comp_code: cc, type: t, b_type: bt, bill_no: no },
      comp_uid
    );
    const nextNo = Number(rows?.[0]?.N ?? rows?.[0]?.n ?? 0) || 0;
    if (!nextNo) return { ok: true, bill_no: null };
    return { ok: true, bill_no: nextNo };
  }

  // ---------------------------------------------------------------------
  // Delete satellite rows (LEDGER / BILLS / LOTSTOCK) for one bill key. Missing/renamed
  // optional columns degrade gracefully (ORA-00904 / ORA-00942).
  // ---------------------------------------------------------------------
  async function deleteSatelliteRows(q, { comp_code, comp_year, type, b_type, bill_date, bill_no }) {
    const binds = { comp_code, comp_year: Number(comp_year) || 0, type, b_type, bill_no, bill_date };
    try {
      await q(
        `DELETE FROM LEDGER WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
           AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
        binds
      );
    } catch (e) {
      if (!isLoginOptionalTableError(e)) throw e;
    }
    try {
      await q(
        `DELETE FROM BILLS WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
           AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
        binds
      );
    } catch (e) {
      if (!isLoginOptionalTableError(e)) throw e;
    }
    try {
      await q(
        `DELETE FROM LOTSTOCK WHERE COMP_CODE = :comp_code AND TRIM(VR_TYPE) = TRIM(:type)
           AND VR_NO = :bill_no AND E_TYPE = 'S'
           AND TRUNC(VR_DATE) = TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))`,
        binds
      );
    } catch (e) {
      if (!isLoginOptionalTableError(e)) throw e;
    }
  }

  // ---------------------------------------------------------------------
  // Save (add / edit / delete).
  // ---------------------------------------------------------------------
  async function saveSaleBill(comp_code, comp_year, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    const mode = String(body.mode ?? 'add').trim().toLowerCase();
    if (!['add', 'edit', 'delete'].includes(mode)) {
      const err = new Error("mode must be 'add', 'edit', or 'delete'.");
      err.status = 400;
      throw err;
    }
    await assertSalePermission(user_name, mode === 'add' ? 'add' : mode === 'edit' ? 'edit' : 'delete');

    const cc = Number(comp_code) || 0;
    const type = String(body.type ?? SL_TYPE).trim().toUpperCase() || SL_TYPE;
    let b_type = String(body.b_type ?? 'N').trim() || 'N';
    const header = body.header && typeof body.header === 'object' ? body.header : {};
    const footer = body.footer && typeof body.footer === 'object' ? body.footer : {};
    const hdr = { ...header, ...footer }; // footer expenses win over header stubs
    let bill_date = formatDateBind(body.bill_date ?? hdr.bill_date);
    let bill_no = Number(body.bill_no ?? header.bill_no ?? 0) || 0;

    if (mode === 'delete') {
      if (!bill_no) {
        const err = new Error('bill_no is required for delete.');
        err.status = 400;
        throw err;
      }
      // bill_date/comp_year aren't always known by the caller for delete — resolve from the existing row.
      if (!bill_date || !comp_year) {
        const existing = await runQuery(
          `SELECT COMP_YEAR, BILL_DATE, B_TYPE FROM SALE
             WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type) AND BILL_NO = :bill_no
               AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N') AND ROWNUM = 1`,
          { comp_code: cc, type, bill_no, b_type },
          comp_uid
        );
        const ex = existing?.[0];
        if (!ex) {
          const err = new Error(`Sale Bill ${bill_no} not found.`);
          err.status = 404;
          throw err;
        }
        if (!bill_date) bill_date = formatDateBind(ex.BILL_DATE ?? ex.bill_date);
        if (!comp_year) comp_year = Number(ex.COMP_YEAR ?? ex.comp_year) || comp_year;
        b_type = String(ex.B_TYPE ?? ex.b_type ?? b_type).trim() || b_type;
      }
      const cy = Number(comp_year) || 0;
      return runInCompTx(comp_uid, async (exec) => {
        const q = makeQuery(comp_uid, exec);
        await deleteSatelliteRows(q, { comp_code: cc, comp_year: cy, type, b_type, bill_date, bill_no });
        await q(
          `DELETE FROM SALE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
             AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
          { comp_code: cc, type, bill_no, b_type }
        );
        return { ok: true, mode: 'delete', bill_no };
      });
    }

    if (!bill_date) {
      const err = new Error('bill_date (DD-MM-YYYY) is required.');
      err.status = 400;
      throw err;
    }

    const compdet = await fetchCompdetRow(cc, comp_uid);
    const fyCheck = assertBillDateInFinancialYear(bill_date, compdet);
    if (!fyCheck.ok) {
      const err = new Error(fyCheck.error);
      err.status = 400;
      throw err;
    }
    const cy = Number(comp_year) || Number(rowValueCI(compdet, 'comp_year')) || 0;
    const gFinYear = computeGFinYear(compdet);

    return runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);

      if (mode === 'add' && !bill_no) {
        bill_no = await fetchNextBillNo(cc, comp_uid, type, b_type);
      } else if (mode === 'add' && bill_no) {
        const exRows = await q(
          `SELECT COUNT(*) AS CNT FROM SALE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
             AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
          { comp_code: cc, type, bill_no, b_type }
        );
        const cnt = Number(exRows?.[0]?.CNT ?? exRows?.[0]?.cnt ?? 0) || 0;
        if (cnt > 0) {
          const err = new Error(`Bill number ${bill_no} already exists.`);
          err.status = 400;
          throw err;
        }
      }
      if (!bill_no) {
        const err = new Error('bill_no is required for edit.');
        err.status = 400;
        throw err;
      }

      const code = normCode(hdr.code ?? body.code);
      if (!code) {
        const err = new Error('header.code (billed-to party) is required.');
        err.status = 400;
        throw err;
      }
      const partyRow = await assertMasterCode(cc, code, comp_uid, 'Party');
      const bk_code = normCode(hdr.bk_code ?? hdr.b_code ?? body.bk_code);
      if (bk_code) await assertMasterCode(cc, bk_code, comp_uid, 'Broker');
      const delv_code = normCode(hdr.delv_code) || code;

      const linesIn = Array.isArray(body.lines) ? body.lines : [];
      const linesFiltered = linesIn.filter((raw) => String(raw?.item_code ?? raw?.ITEM_CODE ?? '').trim() !== '');
      if (!linesFiltered.length) {
        const err = new Error('At least one line with item_code is required.');
        err.status = 400;
        throw err;
      }
      for (const ln of linesFiltered) {
        await assertItemCode(cc, ln.item_code ?? ln.ITEM_CODE, comp_uid);
      }

      const flags = await fetchSaleDefFlags(cc, comp_uid);
      const initBt = await fetchSaleBillTypeInit(cc, b_type, comp_uid);
      const sale_inv_no = computeSaleInvNo({
        b_type,
        billNoInt: bill_no,
        initBt,
        initDef: flags.sale_bill_init,
        gFinYear,
        finYearYn: flags.fin_year_yn,
      });

      if (mode === 'edit') {
        await deleteSatelliteRows(q, { comp_code: cc, comp_year: cy, type, b_type, bill_date, bill_no });
        await q(
          `DELETE FROM SALE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
             AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
          { comp_code: cc, type, bill_no, b_type }
        );
      }

      const days = num(hdr.days ?? hdr.due);
      const labour = clampCharge(hdr.labour);
      const freight = clampCharge(hdr.freight);
      const ins = clampCharge(hdr.ins);
      const othExps = {};
      const othCds = {};
      let othExpSum = 0;
      for (let i = 1; i <= 10; i += 1) {
        const amt = clampSigned(hdr[`oth_exp${i}`]);
        othExps[`oth_exp${i}`] = amt;
        othExpSum += amt;
        const cd = hdr[`oth_cd${i}`];
        othCds[`oth_cd${i}`] = cd != null && String(cd).trim() !== '' ? Number(cd) || String(cd).trim() : null;
      }
      const oth_exp = othExpSum || clampSigned(hdr.oth_exp ?? hdr.addexp);
      const add_code =
        othCds.oth_cd1 != null
          ? Number(othCds.oth_cd1) || null
          : hdr.add_code != null && hdr.add_code !== ''
            ? Number(hdr.add_code) || null
            : hdr.oth_code != null && hdr.oth_code !== ''
              ? Number(hdr.oth_code) || null
              : null;
      const bill_amt = num(hdr.bill_amt ?? body.bill_amt) || Math.round(linesFiltered.reduce((s, l) => s + num(l.amount ?? l.AMOUNT), 0) * 100) / 100;
      const tds_on_amt = num(hdr.tds_on_amt);
      const tds_per = num(hdr.tds_per);
      const tds_amt = num(hdr.tds_amt);
      const truck_no = String(hdr.truck_no ?? hdr.truck ?? '').trim().slice(0, 25);
      const tpt = String(hdr.tpt ?? '').trim().slice(0, 50);
      const gr_no = String(hdr.gr_no ?? '').trim().slice(0, 25);
      const remarks = String(hdr.remarks ?? '').trim().slice(0, 150);
      const mod_reason = String(hdr.mod_reason ?? body.mod_reason ?? '').trim().slice(0, 100);
      const int_type = String(hdr.int_type ?? '').trim().toUpperCase().slice(0, 1) || null;
      const labcd = hdr.labour_code != null && hdr.labour_code !== '' ? Number(hdr.labour_code) || flags.labcd : flags.labcd;
      const fgtcd = hdr.freight_code != null && hdr.freight_code !== '' ? Number(hdr.freight_code) || flags.fgtcd : flags.fgtcd;
      const ins_code = hdr.ins_code != null && hdr.ins_code !== '' ? Number(hdr.ins_code) || flags.ins_code : flags.ins_code;
      const arh_per = num(hdr.arh_per);
      const arh_amt = clampSigned(hdr.arh_amt);
      const arh_code = hdr.arh_code != null && hdr.arh_code !== '' ? Number(hdr.arh_code) || null : null;

      let trn = 1;
      const bindRows = linesFiltered.map((raw, idx) => {
        const isFirst = idx === 0;
        const qnty = num(raw.qnty ?? raw.QNTY);
        const rate = num(raw.rate ?? raw.RATE);
        const amount = num(raw.amount ?? raw.AMOUNT);
        const weight = clampWeight(raw.weight ?? raw.WEIGHT);
        const dis_per = num(raw.dis_per ?? raw.DIS_PER);
        const dis_amt = num(raw.dis_amt ?? raw.DIS_AMT);
        const taxable = num(raw.taxable ?? raw.TAXABLE ?? amount - dis_amt);
        const tno = Number(raw.trn_no ?? raw.TRN_NO ?? trn) || trn;
        trn = tno + 1;
        return {
          comp_code: cc,
          comp_year: cy,
          type,
          b_type,
          bill_date,
          bill_no,
          sale_inv_no,
          code,
          delv_code,
          bk_code: bk_code || null,
          days,
          trn_no: tno,
          ch_no: int6(raw.ch_no ?? raw.CH_NO),
          ch_type: String(raw.ch_type ?? raw.CH_TYPE ?? '').trim().toUpperCase().slice(0, 1) || null,
          so_no: int6(raw.so_no ?? raw.SO_NO),
          item_code: Number(raw.item_code ?? raw.ITEM_CODE) || 0,
          s_code: normCode(raw.s_code ?? raw.S_CODE) || code,
          marka: String(raw.marka ?? raw.MARKA ?? '').trim().slice(0, 30),
          plant_code: String(raw.plant_code ?? raw.PLANT_CODE ?? '').trim().slice(0, 10),
          god_code: normCode(raw.god_code ?? raw.GOD_CODE).slice(0, 10),
          dane: String(raw.dane ?? raw.DANE ?? '').trim().toUpperCase().slice(0, 1) || null,
          dane_wgt: clampWeight(raw.dane_wgt ?? raw.DANE_WGT),
          dane_amt: num(raw.dane_amt ?? raw.DANE_AMT),
          paploo1: num(raw.paploo1 ?? raw.PAPLOO1),
          paploo2: num(raw.paploo2 ?? raw.PAPLOO2),
          paploo3: num(raw.paploo3 ?? raw.PAPLOO3),
          paploo4: num(raw.paploo4 ?? raw.PAPLOO4),
          paploo5: num(raw.paploo5 ?? raw.PAPLOO5),
          p_amt1: num(raw.p_amt1 ?? raw.P_AMT1),
          p_amt2: num(raw.p_amt2 ?? raw.P_AMT2),
          p_amt3: num(raw.p_amt3 ?? raw.P_AMT3),
          p_amt4: num(raw.p_amt4 ?? raw.P_AMT4),
          p_amt5: num(raw.p_amt5 ?? raw.P_AMT5),
          qnty,
          status: normStatus(raw.status ?? raw.STATUS),
          cal: Number(raw.cal ?? raw.CAL ?? 1) || 1,
          e_d: num(raw.e_d ?? raw.E_D),
          e_damt: num(raw.e_damt ?? raw.E_DAMT),
          weight,
          rate,
          amount,
          dis_per,
          dis_amt,
          taxable,
          cgst_per: num(raw.cgst_per ?? raw.CGST_PER),
          sgst_per: num(raw.sgst_per ?? raw.SGST_PER),
          igst_per: num(raw.igst_per ?? raw.IGST_PER),
          cgst_amt: num(raw.cgst_amt ?? raw.CGST_AMT),
          sgst_amt: num(raw.sgst_amt ?? raw.SGST_AMT),
          igst_amt: num(raw.igst_amt ?? raw.IGST_AMT),
          bk_rate: num(raw.bk_rate ?? raw.BK_RATE),
          bk_bw: String(raw.bk_bw ?? raw.BK_BW ?? 'A').trim().toUpperCase().slice(0, 1) || 'A',
          bk_amt: num(raw.bk_amt ?? raw.BK_AMT),
          labour: isFirst ? labour : 0,
          freight: isFirst ? freight : 0,
          ins: isFirst ? ins : 0,
          oth_exp: isFirst ? oth_exp : 0,
          oth_exp1: isFirst ? othExps.oth_exp1 : 0,
          oth_exp2: isFirst ? othExps.oth_exp2 : 0,
          oth_exp3: isFirst ? othExps.oth_exp3 : 0,
          oth_exp4: isFirst ? othExps.oth_exp4 : 0,
          oth_exp5: isFirst ? othExps.oth_exp5 : 0,
          oth_exp6: isFirst ? othExps.oth_exp6 : 0,
          oth_exp7: isFirst ? othExps.oth_exp7 : 0,
          oth_exp8: isFirst ? othExps.oth_exp8 : 0,
          oth_exp9: isFirst ? othExps.oth_exp9 : 0,
          oth_exp10: isFirst ? othExps.oth_exp10 : 0,
          oth_cd1: isFirst ? othCds.oth_cd1 : null,
          oth_cd2: isFirst ? othCds.oth_cd2 : null,
          oth_cd3: isFirst ? othCds.oth_cd3 : null,
          oth_cd4: isFirst ? othCds.oth_cd4 : null,
          oth_cd5: isFirst ? othCds.oth_cd5 : null,
          oth_cd6: isFirst ? othCds.oth_cd6 : null,
          oth_cd7: isFirst ? othCds.oth_cd7 : null,
          oth_cd8: isFirst ? othCds.oth_cd8 : null,
          oth_cd9: isFirst ? othCds.oth_cd9 : null,
          oth_cd10: isFirst ? othCds.oth_cd10 : null,
          arh_per: isFirst ? arh_per : 0,
          arh_amt: isFirst ? arh_amt : 0,
          arh_code: isFirst ? arh_code : null,
          add_code: isFirst ? add_code : null,
          labcd: isFirst ? labcd : null,
          fgtcd: isFirst ? fgtcd : null,
          ins_code: isFirst ? ins_code : null,
          bill_amt: isFirst ? bill_amt : 0,
          tds_on_amt: isFirst ? tds_on_amt : 0,
          tds_per: isFirst ? tds_per : 0,
          tds_amt: isFirst ? tds_amt : 0,
          truck_no,
          tpt,
          gr_no,
          remarks,
          mod_reason,
          int_type: isFirst ? int_type : null,
          // VFP SUP_DATE — default bill_date when blank
          sup_date: formatDateBind(raw.sup_date ?? raw.SUP_DATE) || bill_date,
        };
      });

      await insertSaleLines(q, bindRows);
      await postSatelliteRows(q, {
        comp_code: cc,
        comp_year: cy,
        type,
        b_type,
        bill_date,
        bill_no,
        code,
        bk_code,
        days,
        user_name,
        sale_inv_no,
        bill_amt,
        partyName: String(partyRow?.NAME ?? partyRow?.name ?? '').trim(),
        bindRows,
        labour,
        freight,
        ins,
        oth_exp,
        othExps,
        othCds,
        arh_amt,
        arh_code,
        tds_amt,
        tds_on_amt,
        tds_per,
        labcd,
        fgtcd,
        ins_code,
        add_code,
        tds_code: hdr.tds_code || flags.tds_code,
        cgst_code: hdr.cgst_code || flags.cgst_code,
        sgst_code: hdr.sgst_code || flags.sgst_code,
        igst_code: hdr.igst_code || flags.igst_code,
      });

      return {
        ok: true,
        mode,
        bill_no,
        sale_inv_no,
        lines: bindRows.length,
      };
    });
  }

  /** Column/value pairs for the SALE insert, in order. Optional (schema-risky) columns are tagged. */
  const SALE_INSERT_FIELDS = [
    { col: 'COMP_CODE', val: ':comp_code' },
    { col: 'COMP_YEAR', val: ':comp_year' },
    { col: 'TYPE', val: ':type' },
    { col: 'B_TYPE', val: ':b_type' },
    { col: 'BILL_DATE', val: "TO_DATE(:bill_date, 'DD-MM-YYYY')" },
    { col: 'V_DATE', val: "TO_DATE(:bill_date, 'DD-MM-YYYY')" },
    { col: 'BILL_NO', val: ':bill_no' },
    { col: 'SALE_INV_NO', val: ':sale_inv_no' },
    { col: 'CODE', val: ':code' },
    { col: 'DELV_CODE', val: ':delv_code' },
    { col: 'BK_CODE', val: ':bk_code' },
    { col: 'DAYS', val: ':days' },
    { col: 'TRN_NO', val: ':trn_no' },
    { col: 'CH_NO', val: ':ch_no', optional: true },
    { col: 'CH_TYPE', val: ':ch_type', optional: true },
    { col: 'SO_NO', val: ':so_no', optional: true },
    { col: 'ITEM_CODE', val: ':item_code' },
    { col: 'S_CODE', val: ':s_code' },
    { col: 'MARKA', val: ':marka' },
    { col: 'PLANT_CODE', val: ':plant_code' },
    { col: 'GOD_CODE', val: ':god_code' },
    { col: 'DANE', val: ':dane', optional: true },
    { col: 'DANE_WGT', val: ':dane_wgt', optional: true },
    { col: 'DANE_AMT', val: ':dane_amt', optional: true },
    { col: 'PAPLOO1', val: ':paploo1', optional: true },
    { col: 'PAPLOO2', val: ':paploo2', optional: true },
    { col: 'PAPLOO3', val: ':paploo3', optional: true },
    { col: 'PAPLOO4', val: ':paploo4', optional: true },
    { col: 'PAPLOO5', val: ':paploo5', optional: true },
    { col: 'P_AMT1', val: ':p_amt1', optional: true },
    { col: 'P_AMT2', val: ':p_amt2', optional: true },
    { col: 'P_AMT3', val: ':p_amt3', optional: true },
    { col: 'P_AMT4', val: ':p_amt4', optional: true },
    { col: 'P_AMT5', val: ':p_amt5', optional: true },
    { col: 'QNTY', val: ':qnty' },
    { col: 'STATUS', val: ':status' },
    { col: 'CAL', val: ':cal', optional: true },
    { col: 'E_D', val: ':e_d', optional: true },
    { col: 'E_DAMT', val: ':e_damt', optional: true },
    { col: 'WEIGHT', val: ':weight' },
    { col: 'RATE', val: ':rate' },
    { col: 'AMOUNT', val: ':amount' },
    { col: 'DIS_PER', val: ':dis_per', optional: true },
    { col: 'DIS_AMT', val: ':dis_amt', optional: true },
    { col: 'TAXABLE', val: ':taxable', optional: true },
    { col: 'CGST_PER', val: ':cgst_per', optional: true },
    { col: 'SGST_PER', val: ':sgst_per', optional: true },
    { col: 'IGST_PER', val: ':igst_per', optional: true },
    { col: 'CGST_AMT', val: ':cgst_amt' },
    { col: 'SGST_AMT', val: ':sgst_amt' },
    { col: 'IGST_AMT', val: ':igst_amt' },
    { col: 'BK_RATE', val: ':bk_rate', optional: true },
    { col: 'BK_BW', val: ':bk_bw', optional: true },
    { col: 'BK_AMT', val: ':bk_amt', optional: true },
    { col: 'LABOUR', val: ':labour', optional: true },
    { col: 'FREIGHT', val: ':freight', optional: true },
    { col: 'INS', val: ':ins', optional: true },
    { col: 'OTH_EXP', val: ':oth_exp', optional: true },
    { col: 'OTH_EXP1', val: ':oth_exp1', optional: true },
    { col: 'OTH_EXP2', val: ':oth_exp2', optional: true },
    { col: 'OTH_EXP3', val: ':oth_exp3', optional: true },
    { col: 'OTH_EXP4', val: ':oth_exp4', optional: true },
    { col: 'OTH_EXP5', val: ':oth_exp5', optional: true },
    { col: 'OTH_EXP6', val: ':oth_exp6', optional: true },
    { col: 'OTH_EXP7', val: ':oth_exp7', optional: true },
    { col: 'OTH_EXP8', val: ':oth_exp8', optional: true },
    { col: 'OTH_EXP9', val: ':oth_exp9', optional: true },
    { col: 'OTH_EXP10', val: ':oth_exp10', optional: true },
    { col: 'OTH_CD1', val: ':oth_cd1', optional: true },
    { col: 'OTH_CD2', val: ':oth_cd2', optional: true },
    { col: 'OTH_CD3', val: ':oth_cd3', optional: true },
    { col: 'OTH_CD4', val: ':oth_cd4', optional: true },
    { col: 'OTH_CD5', val: ':oth_cd5', optional: true },
    { col: 'OTH_CD6', val: ':oth_cd6', optional: true },
    { col: 'OTH_CD7', val: ':oth_cd7', optional: true },
    { col: 'OTH_CD8', val: ':oth_cd8', optional: true },
    { col: 'OTH_CD9', val: ':oth_cd9', optional: true },
    { col: 'OTH_CD10', val: ':oth_cd10', optional: true },
    { col: 'ARH_PER', val: ':arh_per', optional: true },
    { col: 'ARH_AMT', val: ':arh_amt', optional: true },
    { col: 'ARH_CODE', val: ':arh_code', optional: true },
    { col: 'ADD_CODE', val: ':add_code', optional: true },
    { col: 'LABCD', val: ':labcd', optional: true },
    { col: 'FGTCD', val: ':fgtcd', optional: true },
    { col: 'INS_CODE', val: ':ins_code', optional: true },
    { col: 'BILL_AMT', val: ':bill_amt' },
    { col: 'TDS_ON_AMT', val: ':tds_on_amt', optional: true },
    { col: 'TDS_PER', val: ':tds_per', optional: true },
    { col: 'TDS_AMT', val: ':tds_amt', optional: true },
    { col: 'TRUCK_NO', val: ':truck_no' },
    { col: 'TPT', val: ':tpt' },
    { col: 'GR_NO', val: ':gr_no' },
    { col: 'REMARKS', val: ':remarks', optional: true },
    { col: 'MOD_REASON', val: ':mod_reason', optional: true },
    { col: 'INT_TYPE', val: ':int_type', optional: true },
    { col: 'SUP_DATE', val: "TO_DATE(:sup_date, 'DD-MM-YYYY')", optional: true },
  ];

  function buildSaleInsertSql(excludeCols) {
    const fields = SALE_INSERT_FIELDS.filter((f) => !excludeCols.has(f.col));
    return `INSERT INTO SALE (${fields.map((f) => f.col).join(', ')}) VALUES (${fields.map((f) => f.val).join(', ')})`;
  }

  /** Best-effort: pull the invalid column name out of an ORA-00904 message. */
  function invalidIdentifierFromError(err) {
    const m = /ORA-00904:\s*"?([A-Z0-9_]+)"?/i.exec(String(err?.message || ''));
    return m ? m[1].toUpperCase() : null;
  }

  /** SALE insert with progressive column dropping (mirrors resilience used elsewhere for schema drift). */
  async function insertSaleLines(q, bindRows) {
    const optionalCols = SALE_INSERT_FIELDS.filter((f) => f.optional).map((f) => f.col);
    const excluded = new Set();
    let guessIdx = 0;
    let lastErr;
    for (let attempt = 0; attempt <= optionalCols.length; attempt += 1) {
      const sql = buildSaleInsertSql(excluded);
      try {
        for (const r of bindRows) await q(sql, r);
        return;
      } catch (err) {
        lastErr = err;
        if (!isLoginOptionalTableError(err)) throw err;
        const bad = invalidIdentifierFromError(err);
        if (bad && optionalCols.includes(bad) && !excluded.has(bad)) {
          excluded.add(bad);
          continue;
        }
        // Could not pinpoint the column — drop the next untried optional one as a guess.
        while (guessIdx < optionalCols.length && excluded.has(optionalCols[guessIdx])) guessIdx += 1;
        if (guessIdx >= optionalCols.length) throw err;
        excluded.add(optionalCols[guessIdx]);
        guessIdx += 1;
      }
    }
    throw lastErr;
  }

  /** LEDGER (taxable Cr per line + party Dr + TDS split + charge/GST Cr) + LOTSTOCK (issue) + BILLS. */
  async function postSatelliteRows(q, ctx) {
    const {
      comp_code, comp_year, type, b_type, bill_date, bill_no, code, bk_code, days, user_name,
      sale_inv_no, bill_amt, partyName, bindRows,
      labour = 0, freight = 0, ins = 0, oth_exp = 0, tds_amt = 0, tds_on_amt = 0, tds_per = 0,
      othExps = {}, othCds = {}, arh_amt = 0, arh_code = null,
      labcd = null, fgtcd = null, ins_code = null, add_code = null, tds_code = null,
      cgst_code = null, sgst_code = null, igst_code = null,
    } = ctx;
    const mdetail = `Bill No.${sale_inv_no} Dated ${bill_date}`.slice(0, 200);
    let trn = 1;

    async function tryLedger(binds, cols) {
      const colList = cols.join(', ');
      const valList = cols.map((c) => `:${c}`).join(', ');
      try {
        await q(`INSERT INTO LEDGER (${colList}) VALUES (${valList})`, binds);
        return true;
      } catch (err) {
        if (!isLoginOptionalTableError(err)) throw err;
        return false;
      }
    }

    async function postLedger({ lcode, dr_amt, cr_amt, dc_code, detail }) {
      const full = [
        'COMP_CODE', 'COMP_YEAR', 'VR_TYPE', 'VR_DATE', 'VR_NO', 'TYPE', 'TRN_NO', 'CODE',
        'DR_AMT', 'CR_AMT', 'DC_CODE', 'DETAIL', 'BILL_DATE', 'BILL_NO', 'V_DATE', 'DAYS', 'BK_CODE', 'USER_NAME',
      ];
      const binds = {
        comp_code, comp_year, vr_type: type, vr_date: bill_date, vr_no: bill_no, type: b_type,
        trn_no: trn, code: lcode, dr_amt, cr_amt, dc_code, detail: String(detail).slice(0, 200),
        bill_date, bill_no, v_date: bill_date, days: Number(days) || 0,
        bk_code: bk_code || null, user_name: String(user_name || '').trim().slice(0, 10),
      };
      binds.vr_date = bill_date;
      const sqlBinds = { ...binds };
      const sql = `INSERT INTO LEDGER (
          COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, TRN_NO, CODE,
          DR_AMT, CR_AMT, DC_CODE, DETAIL, BILL_DATE, BILL_NO, V_DATE, DAYS, BK_CODE, USER_NAME
        ) VALUES (
          :comp_code, :comp_year, :vr_type, TO_DATE(:vr_date, 'DD-MM-YYYY'), :vr_no, :type, :trn_no, :code,
          :dr_amt, :cr_amt, :dc_code, :detail, TO_DATE(:bill_date, 'DD-MM-YYYY'), :bill_no, TO_DATE(:v_date, 'DD-MM-YYYY'), :days, :bk_code, :user_name
        )`;
      try {
        await q(sql, sqlBinds);
        trn += 1;
        return;
      } catch (err) {
        if (!isLoginOptionalTableError(err)) throw err;
      }
      // Fallback: drop optional columns one by one (DAYS, BK_CODE, then BILL_DATE/BILL_NO/V_DATE).
      const fallbackSql = `INSERT INTO LEDGER (
          COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, TRN_NO, CODE, DR_AMT, CR_AMT, DC_CODE, DETAIL, USER_NAME
        ) VALUES (
          :comp_code, :comp_year, :vr_type, TO_DATE(:vr_date, 'DD-MM-YYYY'), :vr_no, :type, :trn_no, :code,
          :dr_amt, :cr_amt, :dc_code, :detail, :user_name
        )`;
      await q(fallbackSql, sqlBinds);
      trn += 1;
    }

    for (const r of bindRows) {
      const taxable = num(r.taxable);
      const sc = normCode(r.s_code);
      if (taxable <= 0 || !sc) continue;
      await postLedger({
        lcode: sc,
        dr_amt: 0,
        cr_amt: taxable,
        dc_code: code,
        detail: `QT.: ${r.qnty} WGT.${r.weight} RATE ${r.rate}`,
      });
    }

    await postLedger({ lcode: code, dr_amt: num(bill_amt), cr_amt: 0, dc_code: bk_code || code, detail: mdetail });

    const tdsLc = Number(tds_code) || 0;
    const tdsA = num(tds_amt);
    if (tdsLc > 0 && tdsA > 0) {
      const tag = `TDS ${num(tds_per)}% on ${num(tds_on_amt)}`;
      await postLedger({ lcode: tdsLc, dr_amt: tdsA, cr_amt: 0, dc_code: code, detail: `${mdetail} — ${tag}` });
      await postLedger({ lcode: code, dr_amt: 0, cr_amt: tdsA, dc_code: bk_code || code, detail: `${mdetail} — ${tag}` });
    }

    const pushCrExpense = async (lcodeRaw, amtRaw, tag) => {
      const lc = Number(lcodeRaw) || 0;
      const a = num(amtRaw);
      if (lc <= 0 || a <= 0) return;
      await postLedger({ lcode: lc, dr_amt: 0, cr_amt: a, dc_code: code, detail: `${mdetail} — ${tag}` });
    };
    await pushCrExpense(labcd, labour, 'Labour');
    await pushCrExpense(fgtcd, freight, 'Freight');
    await pushCrExpense(ins_code, ins, 'Insurance');
    await pushCrExpense(add_code, othExps.oth_exp1 || oth_exp, 'Oth/Add 1');
    for (let i = 2; i <= 10; i += 1) {
      await pushCrExpense(othCds[`oth_cd${i}`], othExps[`oth_exp${i}`], `Oth/Add ${i}`);
    }
    await pushCrExpense(arh_code, arh_amt, 'Arhatiya');

    let sumCgst = 0;
    let sumSgst = 0;
    let sumIgst = 0;
    for (const r of bindRows) {
      sumCgst += num(r.cgst_amt);
      sumSgst += num(r.sgst_amt);
      sumIgst += num(r.igst_amt);
    }
    await pushCrExpense(cgst_code, Math.round(sumCgst * 100) / 100, 'CGST');
    await pushCrExpense(sgst_code, Math.round(sumSgst * 100) / 100, 'SGST');
    await pushCrExpense(igst_code, Math.round(sumIgst * 100) / 100, 'IGST');

    // LOTSTOCK issue rows (E_TYPE = 'S') — stock reduction per line.
    for (const r of bindRows) {
      const ic = Number(r.item_code) || 0;
      if (!ic) continue;
      const full = `INSERT INTO LOTSTOCK (
          COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, E_TYPE, SUP_CODE, ITEM_CODE, STATUS,
          QNTY, WEIGHT, RATE, AMOUNT, LOT, B_NO, GOD_CODE, USER_NAME
        ) VALUES (
          :comp_code, :comp_year, :vr_type, TO_DATE(:bill_date, 'DD-MM-YYYY'), :bill_no, 'S', :sup_code, :item_code, :status,
          :qnty, :weight, :rate, :amount, :lot, :b_no, :god_code, :user_name
        )`;
      const binds = {
        comp_code, comp_year, vr_type: type, bill_date, bill_no,
        sup_code: r.s_code || code, item_code: ic, status: r.status,
        qnty: num(r.qnty), weight: num(r.weight), rate: num(r.rate), amount: num(r.amount),
        lot: 0, b_no: 0, god_code: r.god_code || null, user_name: String(user_name || '').trim().slice(0, 10),
      };
      try {
        await q(full, binds);
      } catch (err) {
        if (!isLoginOptionalTableError(err)) throw err;
        try {
          await q(
            `INSERT INTO LOTSTOCK (
               COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, E_TYPE, SUP_CODE, ITEM_CODE, STATUS,
               QNTY, WEIGHT, RATE, AMOUNT
             ) VALUES (
               :comp_code, :comp_year, :vr_type, TO_DATE(:bill_date, 'DD-MM-YYYY'), :bill_no, 'S', :sup_code, :item_code, :status,
               :qnty, :weight, :rate, :amount
             )`,
            binds
          );
        } catch (err2) {
          if (!isLoginOptionalTableError(err2)) throw err2;
        }
      }
    }

    // BILLS (party ageing).
    const billFull = `INSERT INTO BILLS (
        COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, BILL_DATE, BILL_NO, B_TYPE,
        DR_AMT, CR_AMT, V_DATE, DAYS, BK_CODE, DETAIL
      ) VALUES (
        :comp_code, :comp_year, :vr_type, TO_DATE(:bill_date, 'DD-MM-YYYY'), :bill_no, :b_type, :code,
        TO_DATE(:bill_date, 'DD-MM-YYYY'), :bill_no, :b_type, :dr_amt, 0,
        TO_DATE(:bill_date, 'DD-MM-YYYY'), :days, :bk_code, :detail
      )`;
    const billBinds = {
      comp_code, comp_year, vr_type: type, bill_date, bill_no, b_type, code,
      dr_amt: num(bill_amt), days: Number(days) || 0, bk_code: bk_code || null,
      detail: (partyName || mdetail).slice(0, 200),
    };
    try {
      await q(billFull, billBinds);
    } catch (err) {
      if (!isLoginOptionalTableError(err)) throw err;
      await q(
        `INSERT INTO BILLS (
           COMP_CODE, COMP_YEAR, VR_TYPE, VR_DATE, VR_NO, TYPE, CODE, DR_AMT, CR_AMT, DETAIL
         ) VALUES (
           :comp_code, :comp_year, :vr_type, TO_DATE(:bill_date, 'DD-MM-YYYY'), :bill_no, :b_type, :code, :dr_amt, 0, :detail
         )`,
        billBinds
      );
    }
  }

  // ---------------------------------------------------------------------
  // Routes.
  // ---------------------------------------------------------------------
  function registerRoutes(app) {
    // --- Literal WINDAL-parity endpoints (Source list) ---
    app.get('/api/sale-bill-user-permissions', async (req, res) => {
      try {
        const { comp_uid, user_name } = req.query;
        if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
          return res.status(400).json({ error: 'comp_uid and user_name are required' });
        }
        const data = await fetchSaleUserPermissions(String(user_name));
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-form-context', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const data = await fetchContext(comp_code, comp_uid);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-form-context error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-lookups', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        res.json(await fetchLookups(comp_code, comp_uid));
      } catch (err) {
        console.error('❌ sale-bill-lookups error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/marka-help', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const lookups = await fetchLookups(comp_code, comp_uid);
        const rows = (lookups.markas || [])
          .map((r) => {
            const marka = String(r.MARKA ?? r.marka ?? '').trim();
            return marka ? { marka, MARKA: marka } : null;
          })
          .filter(Boolean);
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/marka-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    /** VFP danecal — SELECT DANE,BAGS,KATTA,HKATTA FROM DANE … BROW TITLE 'Dane Type' */
    app.get('/api/sale-bill-entry/dane-help', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const rows = await runQuery(
          `SELECT TRIM(DANE) AS DANE,
                  NVL(BAGS, 0) AS BAGS,
                  NVL(KATTA, 0) AS KATTA,
                  NVL(HKATTA, 0) AS HKATTA
           FROM DANE
           WHERE COMP_CODE = :comp_code
           ORDER BY 1`,
          { comp_code: Number(comp_code) || 0 },
          comp_uid,
          { suppressDbErrorLog: true }
        ).catch(() => []);
        res.json(
          (rows || []).map((r, idx) => {
            const dane = String(r.DANE ?? r.dane ?? '')
              .trim()
              .toUpperCase()
              .slice(0, 1);
            return {
              _id: `${dane}-${idx}`,
              dane,
              bags: num(r.BAGS ?? r.bags),
              katta: num(r.KATTA ?? r.katta),
              hkatta: num(r.HKATTA ?? r.hkatta),
            };
          }).filter((r) => r.dane)
        );
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/dane-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-next-bill-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, b_type } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const next_bill_no = await fetchNextBillNo(comp_code, comp_uid, type, b_type);
        res.json({ next_bill_no });
      } catch (err) {
        console.error('❌ sale-bill-next-bill-no error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-pending-challans', async (req, res) => {
      try {
        const { comp_code, comp_uid, code, bk_code } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        res.json(await fetchPendingChallans(comp_code, comp_uid, { code, bk_code }));
      } catch (err) {
        console.error('❌ sale-bill-pending-challans error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-pending-orders', async (req, res) => {
      try {
        const { comp_code, comp_uid, code, bk_code, item_code } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const rows = await fetchPendingOrders(comp_code, comp_uid, { code, bk_code, item_code });
        res.json({ rows });
      } catch (err) {
        console.error('❌ sale-bill-pending-orders error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-inv-no-preview', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, b_type, bill_no } = req.query;
        if (!comp_code || comp_uid == null || bill_no == null) {
          return res.status(400).json({ error: 'comp_code, comp_uid, bill_no are required' });
        }
        const data = await fetchInvNoPreview(comp_code, comp_uid, { type, b_type, bill_no });
        res.json(data);
      } catch (err) {
        console.error('❌ sale-bill-inv-no-preview error:', err.message);
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/sale-bill-save', async (req, res) => {
      try {
        const body = req.body || {};
        const comp_code = body.comp_code;
        const comp_year = body.comp_year ?? 0;
        const comp_uid = body.comp_uid;
        if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const result = await saveSaleBill(comp_code, comp_year, comp_uid, body, req);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-save error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    // --- Module-style endpoints (requirements #2–#4) ---
    app.get('/api/sale-bill-entry/context', async (req, res) => {
      try {
        const { comp_code, comp_uid } = req.query;
        if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        res.json(await fetchContext(comp_code, comp_uid));
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/context error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/user-permissions', async (req, res) => {
      try {
        const { comp_uid, user_name } = req.query;
        if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
          return res.status(400).json({ error: 'comp_uid and user_name are required' });
        }
        res.json(await fetchSaleUserPermissions(String(user_name)));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, b_type } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const next_no = await fetchNextBillNo(comp_code, comp_uid, type, b_type);
        res.json({ ok: true, next_no, next_bill_no: next_no });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, b_type, sdt, edt, party } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const rows = await listSaleBills(comp_code, comp_uid, { type, b_type, sdt, edt, party });
        res.json({ ok: true, rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/list error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/nav', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, b_type, bill_no, direction } = req.query;
        if (!comp_code || comp_uid == null || bill_no == null) {
          return res.status(400).json({ error: 'comp_code, comp_uid, bill_no are required' });
        }
        res.json(await navSaleBill(comp_code, comp_uid, type, b_type, bill_no, direction));
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/so-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, code, bk_code, item_code } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const rows = await fetchPendingOrders(comp_code, comp_uid, { code, bk_code, item_code });
        res.json(Array.isArray(rows) ? rows : rows?.rows || []);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/so-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry/ch-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, code, bk_code } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const rows = await fetchPendingChallans(comp_code, comp_uid, { code, bk_code });
        res.json(Array.isArray(rows) ? rows : rows?.rows || []);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/ch-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    /**
     * Lot help — VFP sale_gst Lothlp browse:
     * B_no, SCODE, Sup_name, ITEM, INAME, Lot, U, GD, ARV.DATE, Rqty, Sqty, Bqty, Bwgt, Remarks, Rate, Msup_name
     */
    app.get('/api/sale-bill-entry/lot-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, item_code, bill_date, sup_code, remarks } = req.query;
        if (!comp_code || comp_uid == null) {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const cc = Number(comp_code) || 0;
        const ic = Number(item_code) || 0;
        const sc = normCode(sup_code);
        const remarksFilter = String(remarks ?? '')
          .trim()
          .toUpperCase();
        const binds = { comp_code: cc };
        let extra = '';

        // VFP: IF G_SALE_STOCK_CHK='Y' THEN A.VR_DATE<=BILL_DATE
        let saleStockChk = 'N';
        try {
          saleStockChk = String(await fetchDefvalueCol(cc, comp_uid, 'SALE_STOCK_CHK', 'N'))
            .trim()
            .toUpperCase();
        } catch {
          saleStockChk = 'N';
        }
        const bd = formatDateBind(bill_date);
        if (saleStockChk === 'Y' && bd) {
          binds.bill_date = bd;
          extra += " AND TRUNC(A.VR_DATE) <= TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))";
        }
        if (ic) {
          binds.item_code = ic;
          extra += ' AND A.ITEM_CODE = :item_code';
        }
        if (sc) {
          binds.sup_code = sc;
          extra += ' AND TRIM(A.SUP_CODE) = TRIM(:sup_code)';
        }

        const lotCols = await fetchTableColumns('LOTSTOCK', comp_uid);
        const lotHas = (c) => lotCols.size === 0 || lotCols.has(String(c).toUpperCase());
        const bNoExpr = lotHas('B_NO') ? 'MAX(A.B_NO)' : "''";
        const remarksExpr = lotHas('REMARKS') ? "MAX(TRIM(NVL(A.REMARKS, ' ')))" : "''";
        const msupExpr = lotHas('MSUP_CODE') ? "MAX(TRIM(NVL(A.MSUP_CODE, ' ')))" : "''";
        const msupNameExpr = lotHas('MSUP_CODE') ? 'MAX(D.NAME)' : "''";
        const msupJoin = lotHas('MSUP_CODE')
          ? 'LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.MSUP_CODE) = TRIM(D.CODE)'
          : '';

        const rows = await runQuery(
          `SELECT
             ${bNoExpr} AS B_NO,
             TRIM(MAX(A.SUP_CODE)) AS SUP_CODE,
             MAX(C.NAME) AS SUP_NAME,
             A.ITEM_CODE,
             MAX(B.ITEM_NAME) AS ITEM_NAME,
             A.LOT,
             TRIM(NVL(A.STATUS, 'B')) AS STATUS,
             TRIM(NVL(A.GOD_CODE, ' ')) AS GOD_CODE,
             MIN(A.VR_DATE) AS VR_DATE,
             SUM(CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.QNTY, 0) ELSE 0 END) AS RQTY,
             SUM(CASE WHEN TRIM(A.E_TYPE) = 'S' THEN NVL(A.QNTY, 0) ELSE 0 END) AS SQTY,
             SUM(CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.QNTY, 0) ELSE -NVL(A.QNTY, 0) END) AS BQTY,
             SUM(CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.WEIGHT, 0) ELSE -NVL(A.WEIGHT, 0) END) AS BWGT,
             SUM(CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.AMOUNT, 0) ELSE 0 END) AS RAMT,
             SUM(CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS RWGT,
             ${remarksExpr} AS REMARKS,
             ${msupExpr} AS MSUP_CODE,
             ${msupNameExpr} AS MSUP_NAME
           FROM LOTSTOCK A
           JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
           LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(C.CODE)
           ${msupJoin}
           WHERE A.COMP_CODE = :comp_code${extra}
           GROUP BY A.ITEM_CODE, A.LOT, TRIM(NVL(A.STATUS, 'B')), TRIM(NVL(A.GOD_CODE, ' '))
           HAVING SUM(CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.QNTY, 0) ELSE -NVL(A.QNTY, 0) END) <> 0
           ORDER BY A.ITEM_CODE, A.LOT, STATUS, GOD_CODE`,
          binds,
          comp_uid
        );

        // VFP LOX1: RATE = RAMT/RWGT*100 (per-quintal style when weight is in kg)
        let wgtKq = 'K';
        try {
          wgtKq = String(await fetchDefvalueCol(cc, comp_uid, 'WGT_K_Q', 'K'))
            .trim()
            .toUpperCase();
        } catch {
          wgtKq = 'K';
        }

        let mapped = (rows || []).map((r, idx) => {
          const rwgt = num(r.RWGT ?? r.rwgt);
          const ramt = num(r.RAMT ?? r.ramt);
          let rate = 0;
          if (rwgt) {
            rate =
              wgtKq === 'Q'
                ? Math.round((ramt / rwgt) * 100) / 100
                : Math.round((ramt / rwgt) * 100 * 100) / 100;
          }
          return {
            _id: `${r.ITEM_CODE ?? r.item_code}-${r.LOT ?? r.lot}-${r.STATUS ?? r.status}-${r.GOD_CODE ?? r.god_code}-${idx}`,
            b_no: String(r.B_NO ?? r.b_no ?? '').trim(),
            sup_code: normCode(r.SUP_CODE ?? r.sup_code),
            sup_name: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
            item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
            item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
            lot: String(r.LOT ?? r.lot ?? '').trim(),
            status: normStatus(r.STATUS ?? r.status),
            god_code: normCode(r.GOD_CODE ?? r.god_code),
            vr_date: formatDateOut(r.VR_DATE ?? r.vr_date),
            rqty: num(r.RQTY ?? r.rqty),
            sqty: num(r.SQTY ?? r.sqty),
            b_qty: num(r.BQTY ?? r.bqty),
            b_wgt: num(r.BWGT ?? r.bwgt),
            remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
            rate,
            msup_code: normCode(r.MSUP_CODE ?? r.msup_code),
            msup_name: String(r.MSUP_NAME ?? r.msup_name ?? '').trim(),
            mrp: 0,
          };
        });
        if (remarksFilter) {
          mapped = mapped.filter((r) => String(r.remarks || '').toUpperCase().includes(remarksFilter));
        }
        res.json(mapped);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry/lot-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/sale-bill-entry', async (req, res) => {
      try {
        const { comp_code, comp_uid, type, b_type, bill_no } = req.query;
        if (!comp_code || comp_uid == null || bill_no == null) {
          return res.status(400).json({ error: 'comp_code, comp_uid, bill_no are required' });
        }
        res.json(await loadSaleBill(comp_code, comp_uid, type, bill_no, b_type));
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry GET error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.post('/api/sale-bill-entry', async (req, res) => {
      try {
        const body = req.body || {};
        const { comp_code, comp_year, comp_uid } = body;
        if (!comp_code || comp_uid == null || String(comp_uid).trim() === '') {
          return res.status(400).json({ error: 'comp_code and comp_uid are required' });
        }
        const merged = { ...body, mode: body.mode === 'delete' ? 'delete' : body.mode || 'add' };
        const result = await saveSaleBill(comp_code, comp_year, comp_uid, merged, req);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry POST error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.delete('/api/sale-bill-entry', async (req, res) => {
      try {
        const q = req.query || {};
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = q.comp_code ?? body.comp_code;
        const comp_uid = q.comp_uid ?? body.comp_uid;
        const comp_year = q.comp_year ?? body.comp_year ?? 0;
        const bill_no = q.bill_no ?? body.bill_no;
        const type = q.type ?? body.type;
        const b_type = q.b_type ?? body.b_type;
        const user_name = resolveUserName(body, req) || String(q.user_name ?? '').trim();
        if (!comp_code || comp_uid == null || bill_no == null) {
          return res.status(400).json({ error: 'comp_code, comp_uid, bill_no are required' });
        }
        const result = await saveSaleBill(
          comp_code,
          comp_year,
          comp_uid,
          { mode: 'delete', bill_no, type, b_type, bill_date: q.bill_date ?? body.bill_date, user_name },
          req
        );
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ sale-bill-entry DELETE error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });
  }

  return {
    registerRoutes,
    fetchContext,
    fetchSaleUserPermissions,
    fetchLookups,
    fetchNextBillNo,
    fetchInvNoPreview,
    fetchPendingChallans,
    fetchPendingOrders,
    loadSaleBill,
    listSaleBills,
    navSaleBill,
    saveSaleBill,
  };
}

module.exports = { createSaleBillEntry, SL_TYPE };
