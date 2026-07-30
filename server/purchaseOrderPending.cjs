/**
 * VFP porder.prg — POPND (summary) and POPNDDET (detail).
 */

'use strict';

function joinKey(soNo, itemCode, status) {
  return `${Number(soNo) || 0}|${Number(itemCode) || 0}|${String(status || 'B').trim().toUpperCase()}`;
}

function mapPoRow(r, normCode, normStatus, num, formatDateOut) {
  return {
    so_no: Number(r.SO_NO ?? r.so_no ?? 0) || 0,
    so_date: formatDateOut(r.SO_DATE ?? r.so_date),
    delv_date: formatDateOut(r.DELV_DATE ?? r.delv_date),
    code: normCode(r.CODE ?? r.code),
    name: String(r.NAME ?? r.name ?? '').trim(),
    city: String(r.CITY ?? r.city ?? '').trim(),
    bk_code: normCode(r.BK_CODE ?? r.bk_code),
    bk_name: String(r.BNAME ?? r.bname ?? '').trim(),
    sup_code: normCode(r.SUP_CODE ?? r.sup_code),
    sup_name: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
    item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
    status: normStatus(r.STATUS ?? r.status),
    rate: num(r.RATE ?? r.rate),
    po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
    so_qty: num(r.QNTY ?? r.qnty),
    so_wgt: num(r.WEIGHT ?? r.weight),
    remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
    p_condition: String(r.P_CONDITION ?? r.p_condition ?? '').trim(),
    delv_mth: String(r.DELV_MTH ?? r.delv_mth ?? '').trim(),
    clear_yn: String(r.CLEAR_YN ?? r.clear_yn ?? 'N').trim().toUpperCase(),
    god_code: normCode(r.GOD_CODE ?? r.god_code),
    loc_code: normCode(r.LOC_CODE ?? r.loc_code),
  };
}

function createPurchaseOrderPending({
  runQuery,
  parseDateOnly,
  PO_TYPE,
  normCode,
  normStatus,
  num,
  formatDateOut,
  fetchPorderQw,
}) {
  function formatDateBind(raw) {
    const d = parseDateOnly(raw);
    if (!d || Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  async function fetchPoLines(comp_code, comp_uid, sdt, edt) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT
        A.SO_NO, TRUNC(A.SO_DATE) AS SO_DATE, TRUNC(A.DELV_DATE) AS DELV_DATE,
        A.BK_CODE, A.PO_NO, A.ITEM_CODE, A.STATUS, A.QNTY, A.WEIGHT, A.RATE, A.CODE,
        B.ITEM_NAME, C.NAME, C.CITY, D.NAME AS BNAME, A.SUP_CODE, E.NAME AS SUP_NAME,
        A.REMARKS, A.DELV_MTH, A.P_CONDITION, A.CLEAR_YN, A.GOD_CODE, A.LOC_CODE
      FROM PORDER A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      LEFT JOIN MASTER E ON A.COMP_CODE = E.COMP_CODE AND A.SUP_CODE = E.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND TRUNC(A.SO_DATE) BETWEEN TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))
      ORDER BY A.CODE, A.ITEM_CODE, A.STATUS, A.SO_NO`;
    const rows = await runQuery(
      sql,
      { comp_code: cc, type: PO_TYPE, sdt: formatDateBind(sdt), edt: formatDateBind(edt) },
      comp_uid
    );
    return (rows || []).map((r) => mapPoRow(r, normCode, normStatus, num, formatDateOut));
  }

  async function fetchPurchaseGrouped(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT
        A.SO_NO,
        MAX(TRUNC(A.R_DATE)) AS SO_DATE,
        A.ITEM_CODE,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        MAX(NVL(A.RATE, 0)) AS RATE,
        SUM(CASE WHEN TRIM(A.TYPE) = 'PU' THEN NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) * -1 END) AS SL_QTY,
        SUM(CASE WHEN TRIM(A.TYPE) = 'PU' THEN NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) * -1 END) AS SL_WGT
      FROM PURCHASE A
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) IN ('PU', 'DN')
        AND NVL(A.SO_NO, 0) <> 0
      GROUP BY A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B'))`;
    const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
    const map = new Map();
    for (const r of rows || []) {
      map.set(joinKey(r.SO_NO ?? r.so_no, r.ITEM_CODE ?? r.item_code, r.STATUS ?? r.status), {
        sl_qty: num(r.SL_QTY ?? r.sl_qty),
        sl_wgt: num(r.SL_WGT ?? r.sl_wgt),
        rate: num(r.RATE ?? r.rate),
      });
    }
    return map;
  }

  async function fetchPurchaseDetailLines(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT
        A.SO_NO, TRUNC(A.R_DATE) AS SO_DATE, NVL(A.R_NO, 0) AS R_NO,
        NVL(A.BILL_NO, ' ') AS BILL_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        NVL(A.RATE, 0) AS RATE, A.CODE, B.NAME, C.ITEM_NAME,
        NVL(A.QNTY, 0) AS QNTY, NVL(A.WEIGHT, 0) AS WEIGHT, TRIM(A.TYPE) AS TYPE,
        NVL(A.B_CODE, ' ') AS BK_CODE, D.NAME AS B_NAME, NVL(A.GOD_CODE, ' ') AS GOD_CODE
      FROM PURCHASE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.B_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND NVL(A.SO_NO, 0) <> 0
      ORDER BY A.SO_NO, A.R_DATE, A.R_NO`;
    const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
    return rows || [];
  }

  function applyCommonFilters(rows, opts) {
    let list = rows.filter((r) => r.clear_yn !== 'Y');
    const code = normCode(opts.code);
    if (code) list = list.filter((r) => r.code === code);
    const itemCode = Number(opts.item_code) || 0;
    if (itemCode) list = list.filter((r) => r.item_code === itemCode);
    const bk = normCode(opts.bk_code);
    if (bk) list = list.filter((r) => r.bk_code === bk);
    const sup = normCode(opts.sup_code);
    if (sup) list = list.filter((r) => r.sup_code === sup);
    const god = normCode(opts.god_code);
    if (god) list = list.filter((r) => r.god_code === god);
    const loc = normCode(opts.loc_code);
    if (loc) list = list.filter((r) => r.loc_code === loc);
    const sono = Number(opts.so_no) || 0;
    if (sono) list = list.filter((r) => r.so_no === sono);
    return list;
  }

  function sumTotals(rows, keys) {
    const t = {};
    for (const k of keys) t[k] = 0;
    for (const r of rows) {
      for (const k of keys) t[k] += num(r[k]);
    }
    return t;
  }

  async function fetchPendingSummary(comp_code, comp_uid, opts = {}) {
    const porderQw = await fetchPorderQw(comp_code, comp_uid);
    const qIgnore = num(opts.qnty_ignore);
    const [poLines, puMap] = await Promise.all([
      fetchPoLines(comp_code, comp_uid, opts.sdt, opts.edt),
      fetchPurchaseGrouped(comp_code, comp_uid),
    ]);
    const filtered = applyCommonFilters(poLines, opts);

    const grouped = new Map();
    for (const row of filtered) {
      const gk = `${row.so_no}|${row.so_date}|${row.code}|${row.name}|${row.city}|${row.bk_code}|${row.bk_name}|${row.item_code}|${row.item_name}|${row.status}`;
      if (!grouped.has(gk)) {
        grouped.set(gk, {
          ...row,
          so_qty: 0,
          so_wgt: 0,
        });
      }
      const g = grouped.get(gk);
      g.so_qty += row.so_qty;
      g.so_wgt += row.so_wgt;
      if (!g.po_no && row.po_no) g.po_no = row.po_no;
      if (!g.remarks && row.remarks) g.remarks = row.remarks;
      if (!g.delv_mth && row.delv_mth) g.delv_mth = row.delv_mth;
      if (!g.p_condition && row.p_condition) g.p_condition = row.p_condition;
      if (!g.delv_date && row.delv_date) g.delv_date = row.delv_date;
      if (!g.rate && row.rate) g.rate = row.rate;
    }

    const joined = [];
    for (const g of grouped.values()) {
      const pu = puMap.get(joinKey(g.so_no, g.item_code, g.status)) || { sl_qty: 0, sl_wgt: 0, rate: 0 };
      const oqty = g.so_qty;
      const rqty = pu.sl_qty;
      const bqty = oqty - rqty;
      const owgt = g.so_wgt;
      const rwgt = pu.sl_wgt;
      const bwgt = owgt - rwgt;
      joined.push({
        ...g,
        oqty,
        rqty,
        bqty,
        owgt,
        rwgt,
        bwgt,
        rate: g.rate || pu.rate,
      });
    }

    const agg = new Map();
    for (const row of joined) {
      const ak = `${row.so_no}|${row.item_code}|${row.status}|${row.code}|${row.name}|${row.city}|${row.bk_code}|${row.bk_name}|${row.item_name}`;
      if (!agg.has(ak)) {
        agg.set(ak, {
          so_no: row.so_no,
          so_date: row.so_date,
          delv_date: row.delv_date,
          code: row.code,
          name: row.name,
          city: row.city,
          bk_code: row.bk_code,
          bk_name: row.bk_name,
          sup_code: row.sup_code,
          sup_name: row.sup_name,
          item_code: row.item_code,
          item_name: row.item_name,
          status: row.status,
          loc_code: row.loc_code,
          god_code: row.god_code,
          po_no: row.po_no,
          remarks: row.remarks,
          delv_mth: row.delv_mth,
          p_condition: row.p_condition,
          rate: row.rate,
          oqty: 0,
          rqty: 0,
          bqty: 0,
          owgt: 0,
          rwgt: 0,
          bwgt: 0,
        });
      }
      const a = agg.get(ak);
      a.oqty += row.oqty;
      a.rqty += row.rqty;
      a.bqty += row.bqty;
      a.owgt += row.owgt;
      a.rwgt += row.rwgt;
      a.bwgt += row.bwgt;
      if (row.so_date && (!a.so_date || row.so_date < a.so_date)) a.so_date = row.so_date;
      if (row.delv_date && (!a.delv_date || row.delv_date > a.delv_date)) a.delv_date = row.delv_date;
      if (!a.loc_code && row.loc_code) a.loc_code = row.loc_code;
      if (!a.god_code && row.god_code) a.god_code = row.god_code;
      if (!a.rate && row.rate) a.rate = row.rate;
    }

    let rows = Array.from(agg.values()).filter((r) => r.so_no >= 1);
    if (porderQw === 'Q') {
      rows = rows.filter((r) => r.bqty >= qIgnore);
    } else {
      rows = rows.filter((r) => r.bwgt >= qIgnore);
    }
    rows.sort((a, b) => {
      const c = String(a.code).localeCompare(String(b.code));
      if (c) return c;
      const i = a.item_code - b.item_code;
      if (i) return i;
      return a.so_no - b.so_no;
    });

    return {
      head_name: 'PENDING PURCHASE ORDER LIST',
      report_type: 'summary',
      porder_q_w: porderQw,
      s_date: formatDateOut(opts.sdt),
      e_date: formatDateOut(opts.edt),
      rows,
      grand: sumTotals(rows, ['oqty', 'rqty', 'bqty', 'owgt', 'rwgt', 'bwgt']),
    };
  }

  async function fetchPendingDetail(comp_code, comp_uid, opts = {}) {
    const porderQw = await fetchPorderQw(comp_code, comp_uid);
    const qIgnore = num(opts.qnty_ignore);
    const [poLines, purchaseRows] = await Promise.all([
      fetchPoLines(comp_code, comp_uid, opts.sdt, opts.edt),
      fetchPurchaseDetailLines(comp_code, comp_uid),
    ]);

    let poFiltered = applyCommonFilters(poLines, opts);
    if (qIgnore >= 0) {
      poFiltered = poFiltered.filter((r) => r.clear_yn !== 'Y');
    }

    const poBySo = new Map();
    for (const r of poFiltered) {
      if (!poBySo.has(r.so_no)) poBySo.set(r.so_no, r);
    }

    const temp = [];
    for (const r of poFiltered) {
      temp.push({
        so_no: r.so_no,
        so_date: r.so_date,
        r_no: 0,
        bill_no: '',
        item_code: r.item_code,
        status: r.status,
        rate: r.rate,
        code: r.code,
        name: r.name,
        item_name: r.item_name,
        so_qty: r.so_qty,
        so_wgt: r.so_wgt,
        sl_qty: 0,
        sl_wgt: 0,
        bk_code: r.bk_code,
        bk_name: r.bk_name,
        sup_code: r.sup_code,
        sup_name: r.sup_name,
        god_code: r.god_code,
        loc_code: r.loc_code,
        m_type: 1,
        pu_type: PO_TYPE,
      });
    }

    for (const r of purchaseRows) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      if (!soNo) continue;
      const poRef = poBySo.get(soNo);
      const puType = String(r.TYPE ?? r.type ?? '').trim().toUpperCase();
      let slQty = num(r.QNTY ?? r.qnty);
      let slWgt = num(r.WEIGHT ?? r.weight);
      if (puType !== 'PU') {
        slQty *= -1;
        slWgt *= -1;
      }
      temp.push({
        so_no: soNo,
        so_date: formatDateOut(r.SO_DATE ?? r.so_date),
        r_no: Number(r.R_NO ?? r.r_no ?? 0) || 0,
        bill_no: String(r.BILL_NO ?? r.bill_no ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        status: normStatus(r.STATUS ?? r.status),
        rate: num(r.RATE ?? r.rate),
        code: normCode(r.CODE ?? r.code),
        name: String(r.NAME ?? r.name ?? '').trim(),
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        so_qty: 0,
        so_wgt: 0,
        sl_qty: slQty,
        sl_wgt: slWgt,
        bk_code: normCode(r.BK_CODE ?? r.bk_code),
        bk_name: String(r.B_NAME ?? r.b_name ?? '').trim(),
        sup_code: poRef?.sup_code || '',
        sup_name: poRef?.sup_name || '',
        god_code: normCode(r.GOD_CODE ?? r.god_code) || poRef?.god_code || '',
        loc_code: poRef?.loc_code || '',
        m_type: 2,
        pu_type: puType,
      });
    }

    let rows = temp;
    rows = applyCommonFilters(
      rows.map((r) => ({ ...r, clear_yn: 'N' })),
      opts
    );

    if (qIgnore >= 0 && poFiltered.length) {
      const openSo = new Set(poFiltered.map((r) => r.so_no));
      rows = rows.filter((r) => openSo.has(r.so_no));
    }

    if (qIgnore !== 0) {
      const bal = new Map();
      for (const r of rows) {
        const k = joinKey(r.so_no, r.item_code, r.status);
        if (!bal.has(k)) bal.set(k, { oqty: 0, rqty: 0, bqty: 0, owgt: 0, rwgt: 0, bwgt: 0, so_no: r.so_no });
        const b = bal.get(k);
        b.oqty += num(r.so_qty);
        b.rqty += num(r.sl_qty);
        b.owgt += num(r.so_wgt);
        b.rwgt += num(r.sl_wgt);
        b.bqty = b.oqty - b.rqty;
        b.bwgt = b.owgt - b.rwgt;
      }
      const keepSo = new Set();
      for (const b of bal.values()) {
        const ok = porderQw === 'Q' ? b.bqty > qIgnore : b.bwgt > qIgnore;
        if (ok && b.so_no >= 1) keepSo.add(b.so_no);
      }
      rows = rows.filter((r) => keepSo.has(r.so_no));
    }

    rows.sort((a, b) => {
      const n = String(a.name).localeCompare(String(b.name));
      if (n) return n;
      const c = String(a.code).localeCompare(String(b.code));
      if (c) return c;
      const s = a.so_no - b.so_no;
      if (s) return s;
      const i = a.item_code - b.item_code;
      if (i) return i;
      const st = String(a.status).localeCompare(String(b.status));
      if (st) return st;
      return a.m_type - b.m_type;
    });

    for (const r of rows) {
      r.bqty = num(r.so_qty) - num(r.sl_qty);
      r.bwgt = num(r.so_wgt) - num(r.sl_wgt);
    }

    return {
      head_name: 'PENDING PURCHASE ORDER LIST',
      report_type: 'detail',
      porder_q_w: porderQw,
      s_date: formatDateOut(opts.sdt),
      e_date: formatDateOut(opts.edt),
      rows,
      grand: sumTotals(rows, ['so_qty', 'sl_qty', 'bqty', 'so_wgt', 'sl_wgt', 'bwgt']),
    };
  }

  return { fetchPendingSummary, fetchPendingDetail };
}

module.exports = { createPurchaseOrderPending };
