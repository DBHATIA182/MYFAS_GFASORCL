/**
 * VFP PRG\sorder.prg — SOPND (summary / date-wise), SOPNDDET (detail), SOPNDDET1 (SO/DO/Sale).
 */

'use strict';

function joinKey(soNo, itemCode, status, rate, useRate) {
  const base = `${Number(soNo) || 0}|${Number(itemCode) || 0}|${String(status || 'B').trim().toUpperCase()}`;
  if (useRate) return `${base}|${Number(rate) || 0}`;
  return base;
}

function mapSoRow(r, normCode, normStatus, num, formatDateOut) {
  return {
    so_no: Number(r.SO_NO ?? r.so_no ?? 0) || 0,
    so_date: formatDateOut(r.SO_DATE ?? r.so_date),
    delv_date: formatDateOut(r.DELV_DATE ?? r.delv_date),
    code: normCode(r.CODE ?? r.code),
    name: String(r.NAME ?? r.name ?? '').trim(),
    city: String(r.CITY ?? r.city ?? '').trim(),
    bk_code: normCode(r.BK_CODE ?? r.bk_code),
    bk_name: String(r.B_NAME ?? r.b_name ?? r.BNAME ?? r.bname ?? '').trim(),
    item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
    item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
    status: normStatus(r.STATUS ?? r.status),
    usd_rate: num(r.USD_RATE ?? r.usd_rate),
    rate: num(r.RATE ?? r.rate),
    po_no: String(r.PO_NO ?? r.po_no ?? '').trim(),
    so_qty: num(r.QNTY ?? r.qnty ?? r.SO_QTY ?? r.so_qty),
    so_wgt: num(r.WEIGHT ?? r.weight ?? r.SO_WGT ?? r.so_wgt),
    remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
    clear_yn: String(r.CLEAR_YN ?? r.clear_yn ?? 'N').trim().toUpperCase(),
    rake_truck: String(r.RAKE_TRUCK ?? r.rake_truck ?? '').trim().toUpperCase().slice(0, 1),
    delv_city: String(r.DELV_CITY ?? r.delv_city ?? '').trim(),
    d_e: String(r.D_E ?? r.d_e ?? 'D').trim().toUpperCase() === 'E' ? 'E' : 'D',
    god_code: normCode(r.GOD_CODE ?? r.god_code),
    pmt_due_days: Number(r.PMT_DUE_DAYS ?? r.pmt_due_days ?? 0) || 0,
  };
}

function createSalesOrderPending({
  runQuery,
  parseDateOnly,
  SO_TYPE,
  normCode,
  normStatus,
  num,
  formatDateOut,
  fetchSorderQw,
}) {
  function formatDateBind(raw) {
    const d = parseDateOnly(raw);
    if (!d || Number.isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  }

  function saleTypesFromMsc(msc) {
    const mode = String(msc ?? 'S').trim().toUpperCase().slice(0, 1);
    // VFP MSC: S = Sale (SL/CN), C = Challan (DC/DR on SALE table).
    if (mode === 'C' || mode === 'D') return { primary: 'DC', reverse: 'DR', msc: 'C' };
    return { primary: 'SL', reverse: 'CN', msc: 'S' };
  }

  async function fetchSoRateChk(comp_code, comp_uid) {
    try {
      const rows = await runQuery(
        `SELECT NVL(SO_RATE_CHK, 'N') AS SO_RATE_CHK FROM defvalue WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: Number(comp_code) || 0 },
        comp_uid
      );
      return String(rows?.[0]?.SO_RATE_CHK ?? rows?.[0]?.so_rate_chk ?? 'N')
        .trim()
        .toUpperCase()
        .slice(0, 1) === 'Y';
    } catch {
      return false;
    }
  }

  async function fetchSoLines(comp_code, comp_uid, sdt, edt) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT
        A.SO_NO, TRUNC(A.SO_DATE) AS SO_DATE, TRUNC(A.DELV_DATE) AS DELV_DATE,
        A.BK_CODE, A.PO_NO, A.ITEM_CODE, A.STATUS, A.QNTY, A.WEIGHT,
        NVL(A.USD_RATE, 0) AS USD_RATE, A.RATE, A.CODE,
        B.ITEM_NAME, C.NAME, C.CITY, D.NAME AS B_NAME, A.REMARKS, A.CLEAR_YN,
        A.RAKE_TRUCK, A.DELV_CITY, NVL(A.D_E, 'D') AS D_E, A.GOD_CODE,
        NVL(A.PMT_DUE_DAYS, 0) AS PMT_DUE_DAYS
      FROM SORDER A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRUNC(A.SO_DATE) BETWEEN TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))
      ORDER BY A.CODE, A.ITEM_CODE, A.STATUS, A.SO_NO`;
    const rows = await runQuery(
      sql,
      { comp_code: cc, sdt: formatDateBind(sdt), edt: formatDateBind(edt) },
      comp_uid
    );
    return (rows || []).map((r) => mapSoRow(r, normCode, normStatus, num, formatDateOut));
  }

  async function fetchSaleGrouped(comp_code, comp_uid, msc, useRate = false) {
    const cc = Number(comp_code) || 0;
    const { primary, reverse } = saleTypesFromMsc(msc);
    const rateGroup = useRate ? ', A.RATE' : '';
    const rateSelect = useRate ? ', A.RATE' : '';
    const sql = `
      SELECT
        A.SO_NO,
        MAX(TRUNC(A.BILL_DATE)) AS SO_DATE,
        A.ITEM_CODE,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS${rateSelect},
        MAX(NVL(A.RATE, 0)) AS RATE,
        SUM(CASE WHEN TRIM(A.TYPE) = :reverse THEN NVL(A.QNTY, 0) * -1 ELSE NVL(A.QNTY, 0) END) AS SL_QTY,
        SUM(CASE WHEN TRIM(A.TYPE) = :reverse THEN NVL(A.WEIGHT, 0) * -1 ELSE NVL(A.WEIGHT, 0) END) AS SL_WGT
      FROM SALE A
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) IN (:primary, :reverse)
        AND NVL(A.SO_NO, 0) <> 0
      GROUP BY A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B'))${rateGroup}`;
    const rows = await runQuery(sql, { comp_code: cc, primary, reverse }, comp_uid);
    const map = new Map();
    for (const r of rows || []) {
      const rate = num(r.RATE ?? r.rate);
      const qty = num(r.SL_QTY ?? r.sl_qty);
      const wgt = num(r.SL_WGT ?? r.sl_wgt);
      const soNo = r.SO_NO ?? r.so_no;
      const item = r.ITEM_CODE ?? r.item_code;
      const status = r.STATUS ?? r.status;
      map.set(joinKey(soNo, item, status, 0, false), { sl_qty: qty, sl_wgt: wgt, rate });
      map.set(joinKey(soNo, item, status, rate, true), { sl_qty: qty, sl_wgt: wgt, rate });
    }
    return map;
  }

  async function fetchSaleDetailLines(comp_code, comp_uid, msc) {
    const cc = Number(comp_code) || 0;
    const { primary, reverse } = saleTypesFromMsc(msc);
    const sql = `
      SELECT
        A.SO_NO, NVL(A.BILL_NO, 0) AS BILL_NO, TRUNC(A.BILL_DATE) AS SO_DATE,
        NVL(A.B_TYPE, ' ') AS B_TYPE, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        NVL(A.RATE, 0) AS RATE, NVL(A.QNTY, 0) AS QNTY, NVL(A.WEIGHT, 0) AS WEIGHT,
        TRIM(A.TYPE) AS TYPE, A.CODE, NVL(A.BK_CODE, ' ') AS BK_CODE,
        B.NAME, C.ITEM_NAME, D.NAME AS B_NAME, NVL(A.GOD_CODE, ' ') AS GOD_CODE
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) IN (:primary, :reverse)
        AND NVL(A.SO_NO, 0) <> 0
      ORDER BY A.SO_NO, A.BILL_DATE, A.BILL_NO`;
    return (await runQuery(sql, { comp_code: cc, primary, reverse }, comp_uid)) || [];
  }

  async function fetchInwardDoLines(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sql = `
      SELECT
        NVL(A.PO_NO, 0) AS SO_NO, NVL(A.BILL_NO, 0) AS BILL_NO, TRUNC(A.BILL_DATE) AS SO_DATE,
        A.ITEM_CODE, TRIM(NVL(A.STATUS, 'B')) AS STATUS, NVL(A.RATE, 0) AS RATE,
        NVL(A.QNTY, 0) AS QNTY, NVL(A.WEIGHT, 0) AS WEIGHT, TRIM(A.TYPE) AS TYPE,
        A.CODE, NVL(A.B_CODE, ' ') AS BK_CODE, B.NAME, C.ITEM_NAME, D.NAME AS B_NAME,
        NVL(A.TIME_IN, ' ') AS VALID_DATE, NVL(A.GOD_CODE, ' ') AS GOD_CODE
      FROM INWARD A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN ITEMMAST C ON A.COMP_CODE = C.COMP_CODE AND A.ITEM_CODE = C.ITEM_CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.B_CODE = D.CODE
      WHERE A.COMP_CODE = :comp_code
        AND NVL(A.PO_NO, 0) <> 0
      ORDER BY A.PO_NO, A.BILL_DATE, A.BILL_NO`;
    try {
      return (await runQuery(sql, { comp_code: cc }, comp_uid)) || [];
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('ORA-00942') || /table or view does not exist/i.test(msg)) return [];
      throw err;
    }
  }

  function applyCommonFilters(rows, opts, { requireClear = true } = {}) {
    let list = rows;
    if (requireClear) list = list.filter((r) => r.clear_yn !== 'Y');
    const code = normCode(opts.code);
    if (code) list = list.filter((r) => r.code === code);
    const itemCode = Number(opts.item_code) || 0;
    if (itemCode) list = list.filter((r) => r.item_code === itemCode);
    const bk = normCode(opts.bk_code);
    if (bk) list = list.filter((r) => r.bk_code === bk);
    const god = normCode(opts.god_code);
    if (god) list = list.filter((r) => r.god_code === god);
    const rake = String(opts.rake_truck ?? '').trim().toUpperCase().slice(0, 1);
    if (rake) list = list.filter((r) => r.rake_truck === rake);
    const dE = String(opts.d_e ?? '').trim().toUpperCase().slice(0, 1);
    if (dE === 'D' || dE === 'E') list = list.filter((r) => r.d_e === dE);
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

  /**
   * VFP SOPND — modes 1 (item sort) and 3 (date sort).
   * @param {object} opts
   * @param {number} [opts.rpt_type=1] 1 = item/so_no, 2 = so_date/so_no
   */
  async function fetchPendingSummary(comp_code, comp_uid, opts = {}) {
    const sorderQw = await fetchSorderQw(comp_code, comp_uid);
    const useRate = await fetchSoRateChk(comp_code, comp_uid);
    const qIgnore = num(opts.qnty_ignore);
    const rptType = Number(opts.rpt_type) === 2 ? 2 : 1;
    const msc = saleTypesFromMsc(opts.msc).msc;

    const [soLines, saleMap] = await Promise.all([
      fetchSoLines(comp_code, comp_uid, opts.sdt, opts.edt),
      fetchSaleGrouped(comp_code, comp_uid, msc, useRate),
    ]);

    const cleared = new Set(soLines.filter((r) => r.clear_yn === 'Y').map((r) => r.so_no));
    const filtered = applyCommonFilters(soLines, opts, { requireClear: true });

    const grouped = new Map();
    for (const row of filtered) {
      const gk = useRate
        ? `${row.so_no}|${row.so_date}|${row.code}|${row.item_code}|${row.status}|${row.rate}`
        : `${row.so_no}|${row.so_date}|${row.code}|${row.item_code}|${row.status}`;
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
      if (!g.delv_date && row.delv_date) g.delv_date = row.delv_date;
      if (!g.delv_city && row.delv_city) g.delv_city = row.delv_city;
      if (!g.rake_truck && row.rake_truck) g.rake_truck = row.rake_truck;
      if (!g.usd_rate && row.usd_rate) g.usd_rate = row.usd_rate;
      if (!g.rate && row.rate) g.rate = row.rate;
      if (!g.bk_name && row.bk_name) g.bk_name = row.bk_name;
      if (!g.god_code && row.god_code) g.god_code = row.god_code;
    }

    const joined = [];
    for (const g of grouped.values()) {
      const sale =
        saleMap.get(joinKey(g.so_no, g.item_code, g.status, g.rate, useRate)) ||
        saleMap.get(joinKey(g.so_no, g.item_code, g.status, 0, false)) ||
        { sl_qty: 0, sl_wgt: 0, rate: 0 };
      const oqty = g.so_qty;
      const rqty = sale.sl_qty;
      const bqty = oqty - rqty;
      const owgt = g.so_wgt;
      const rwgt = sale.sl_wgt;
      const bwgt = owgt - rwgt;
      joined.push({
        ...g,
        oqty,
        rqty,
        bqty,
        owgt,
        rwgt,
        bwgt,
        rate: g.rate || sale.rate,
      });
    }

    const agg = new Map();
    for (const row of joined) {
      const ak = useRate
        ? `${row.so_no}|${row.item_code}|${row.status}|${row.code}|${row.name}|${row.city}|${row.item_name}|${row.rate}`
        : `${row.so_no}|${row.item_code}|${row.status}|${row.code}|${row.name}|${row.city}|${row.item_name}`;
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
          item_code: row.item_code,
          item_name: row.item_name,
          status: row.status,
          god_code: row.god_code,
          po_no: row.po_no,
          remarks: row.remarks,
          rake_truck: row.rake_truck,
          delv_city: row.delv_city,
          d_e: row.d_e,
          usd_rate: row.usd_rate,
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
      if (!a.god_code && row.god_code) a.god_code = row.god_code;
      if (!a.rate && row.rate) a.rate = row.rate;
      if (!a.usd_rate && row.usd_rate) a.usd_rate = row.usd_rate;
      if (!a.bk_name && row.bk_name) a.bk_name = row.bk_name;
    }

    let rows = Array.from(agg.values()).filter((r) => r.so_no >= 1 && !cleared.has(r.so_no));
    if (sorderQw === 'Q') {
      rows = rows.filter((r) => r.bqty > qIgnore);
    } else {
      rows = rows.filter((r) => r.bwgt > qIgnore);
    }

    rows.sort((a, b) => {
      if (rptType === 2) {
        const d = String(a.so_date || '').localeCompare(String(b.so_date || ''));
        if (d) return d;
        return a.so_no - b.so_no;
      }
      const i = a.item_code - b.item_code;
      if (i) return i;
      return a.so_no - b.so_no;
    });

    return {
      head_name: 'PENDING SALES ORDER LIST',
      report_type: rptType === 2 ? 'date-wise' : 'summary',
      sorder_q_w: sorderQw,
      msc,
      so_rate_chk: useRate ? 'Y' : 'N',
      s_date: formatDateOut(opts.sdt),
      e_date: formatDateOut(opts.edt),
      rows,
      grand: sumTotals(rows, ['oqty', 'rqty', 'bqty', 'owgt', 'rwgt', 'bwgt']),
    };
  }

  /** VFP SOPNDDET — mode 2. */
  async function fetchPendingDetail(comp_code, comp_uid, opts = {}) {
    const sorderQw = await fetchSorderQw(comp_code, comp_uid);
    const qIgnore = num(opts.qnty_ignore);
    const msc = saleTypesFromMsc(opts.msc).msc;
    const [soLines, saleRows] = await Promise.all([
      fetchSoLines(comp_code, comp_uid, opts.sdt, opts.edt),
      fetchSaleDetailLines(comp_code, comp_uid, msc),
    ]);

    let poFiltered = soLines;
    if (qIgnore >= 0) {
      poFiltered = poFiltered.filter((r) => r.clear_yn !== 'Y');
    }
    poFiltered = applyCommonFilters(poFiltered, { ...opts, so_no: undefined }, { requireClear: false });

    const temp = [];
    for (const r of poFiltered) {
      temp.push({
        so_no: r.so_no,
        so_date: r.so_date,
        bill_no: r.so_no,
        b_type: '',
        item_code: r.item_code,
        status: r.status,
        rate: r.rate,
        code: r.code,
        name: r.name,
        city: r.city,
        item_name: r.item_name,
        so_qty: r.so_qty,
        so_wgt: r.so_wgt,
        do_qty: 0,
        do_wgt: 0,
        sl_qty: 0,
        sl_wgt: 0,
        bk_code: r.bk_code,
        bk_name: r.bk_name,
        god_code: r.god_code,
        rake_truck: r.rake_truck,
        delv_city: r.delv_city,
        d_e: r.d_e,
        clear_yn: r.clear_yn,
        delv_date: r.delv_date,
        m_type: 1,
        sale_type: SO_TYPE,
        valid_date: '',
      });
    }

    const openSo = new Set(poFiltered.map((r) => r.so_no));
    for (const r of saleRows) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      if (!soNo) continue;
      const saleType = String(r.TYPE ?? r.type ?? '').trim().toUpperCase();
      let slQty = num(r.QNTY ?? r.qnty);
      let slWgt = num(r.WEIGHT ?? r.weight);
      // VFP SOPNDDET: only CN is negated (even when MSC uses DR).
      if (saleType === 'CN') {
        slQty *= -1;
        slWgt *= -1;
      }
      temp.push({
        so_no: soNo,
        so_date: formatDateOut(r.SO_DATE ?? r.so_date),
        bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
        b_type: String(r.B_TYPE ?? r.b_type ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        status: normStatus(r.STATUS ?? r.status),
        rate: num(r.RATE ?? r.rate),
        code: normCode(r.CODE ?? r.code),
        name: String(r.NAME ?? r.name ?? '').trim(),
        city: '',
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        so_qty: 0,
        so_wgt: 0,
        do_qty: 0,
        do_wgt: 0,
        sl_qty: slQty,
        sl_wgt: slWgt,
        bk_code: normCode(r.BK_CODE ?? r.bk_code),
        bk_name: String(r.B_NAME ?? r.b_name ?? '').trim(),
        god_code: normCode(r.GOD_CODE ?? r.god_code),
        rake_truck: '',
        delv_city: '',
        d_e: '',
        clear_yn: '',
        delv_date: '',
        m_type: 2,
        sale_type: saleType,
        valid_date: '',
      });
    }

    let rows = applyCommonFilters(
      temp.map((r) => ({ ...r, clear_yn: r.clear_yn || 'N' })),
      opts,
      { requireClear: false }
    );

    if (qIgnore >= 0 && openSo.size) {
      rows = rows.filter((r) => openSo.has(r.so_no) || Number(opts.so_no) === r.so_no);
    }

    if (qIgnore !== 0) {
      const bal = new Map();
      for (const r of rows) {
        const k = joinKey(r.so_no, r.item_code, r.status, 0, false);
        if (!bal.has(k)) bal.set(k, { oqty: 0, rqty: 0, owgt: 0, rwgt: 0, so_no: r.so_no });
        const b = bal.get(k);
        b.oqty += num(r.so_qty);
        b.rqty += num(r.sl_qty);
        b.owgt += num(r.so_wgt);
        b.rwgt += num(r.sl_wgt);
      }
      const keepSo = new Set();
      for (const b of bal.values()) {
        const bqty = b.oqty - b.rqty;
        const bwgt = b.owgt - b.rwgt;
        const ok = sorderQw === 'Q' ? bqty > qIgnore : bwgt > qIgnore;
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
      const rt = a.rate - b.rate;
      if (rt) return rt;
      const mt = a.m_type - b.m_type;
      if (mt) return mt;
      return String(a.so_date || '').localeCompare(String(b.so_date || ''));
    });

    for (const r of rows) {
      r.bqty = num(r.so_qty) - num(r.sl_qty);
      r.bwgt = num(r.so_wgt) - num(r.sl_wgt);
      r.bqty_so_sl = r.bqty;
      r.bwgt_so_sl = r.bwgt;
      r.bqty_so_do = num(r.so_qty) - num(r.do_qty);
      r.bwgt_so_do = num(r.so_wgt) - num(r.do_wgt);
    }

    return {
      head_name: 'PENDING SALES ORDER LIST',
      report_type: 'detail',
      sorder_q_w: sorderQw,
      msc,
      s_date: formatDateOut(opts.sdt),
      e_date: formatDateOut(opts.edt),
      rows,
      grand: sumTotals(rows, ['so_qty', 'sl_qty', 'bqty', 'so_wgt', 'sl_wgt', 'bwgt']),
    };
  }

  /** VFP SOPNDDET1 — mode 4 Pending SO/DO/Sale (SORDER + INWARD DO + SALE). */
  async function fetchPendingSoDoSale(comp_code, comp_uid, opts = {}) {
    const sorderQw = await fetchSorderQw(comp_code, comp_uid);
    const qIgnore = num(opts.qnty_ignore);
    const msc = saleTypesFromMsc(opts.msc).msc;
    const [soLines, saleRows, inwardRows] = await Promise.all([
      fetchSoLines(comp_code, comp_uid, opts.sdt, opts.edt),
      fetchSaleDetailLines(comp_code, comp_uid, msc),
      fetchInwardDoLines(comp_code, comp_uid),
    ]);

    let poFiltered = soLines;
    if (qIgnore >= 0) {
      poFiltered = poFiltered.filter((r) => r.clear_yn !== 'Y');
    }
    poFiltered = applyCommonFilters(poFiltered, { ...opts, so_no: undefined }, { requireClear: false });

    const temp = [];
    for (const r of poFiltered) {
      const pmtDays = Number(r.pmt_due_days) || 0;
      temp.push({
        so_no: r.so_no,
        so_date: r.so_date,
        bill_no: r.so_no,
        b_type: '',
        item_code: r.item_code,
        status: r.status,
        rate: r.rate,
        code: r.code,
        name: r.name,
        city: r.city,
        item_name: r.item_name,
        so_qty: r.so_qty,
        so_wgt: r.so_wgt,
        do_qty: 0,
        do_wgt: 0,
        sl_qty: 0,
        sl_wgt: 0,
        bk_code: r.bk_code,
        bk_name: r.bk_name,
        god_code: r.god_code,
        rake_truck: r.rake_truck,
        delv_city: r.delv_city,
        d_e: r.d_e,
        clear_yn: r.clear_yn,
        delv_date: r.delv_date,
        pmt_date: r.so_date,
        pmt_due_days: pmtDays,
        m_type: 1,
        sale_type: SO_TYPE,
        valid_date: '',
      });
    }

    const openSo = new Set(poFiltered.map((r) => r.so_no));

    for (const r of saleRows) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      if (!soNo) continue;
      const saleType = String(r.TYPE ?? r.type ?? '').trim().toUpperCase();
      let slQty = num(r.QNTY ?? r.qnty);
      let slWgt = num(r.WEIGHT ?? r.weight);
      if (saleType === 'CN') {
        slQty *= -1;
        slWgt *= -1;
      }
      temp.push({
        so_no: soNo,
        so_date: formatDateOut(r.SO_DATE ?? r.so_date),
        bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
        b_type: String(r.B_TYPE ?? r.b_type ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        status: normStatus(r.STATUS ?? r.status),
        rate: num(r.RATE ?? r.rate),
        code: normCode(r.CODE ?? r.code),
        name: String(r.NAME ?? r.name ?? '').trim(),
        city: '',
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        so_qty: 0,
        so_wgt: 0,
        do_qty: 0,
        do_wgt: 0,
        sl_qty: slQty,
        sl_wgt: slWgt,
        bk_code: normCode(r.BK_CODE ?? r.bk_code),
        bk_name: String(r.B_NAME ?? r.b_name ?? '').trim(),
        god_code: normCode(r.GOD_CODE ?? r.god_code),
        rake_truck: '',
        delv_city: '',
        d_e: '',
        clear_yn: '',
        delv_date: '',
        pmt_date: '',
        pmt_due_days: 0,
        m_type: 2,
        sale_type: saleType,
        valid_date: '',
      });
    }

    for (const r of inwardRows) {
      const soNo = Number(r.SO_NO ?? r.so_no ?? 0) || 0;
      if (!soNo) continue;
      temp.push({
        so_no: soNo,
        so_date: formatDateOut(r.SO_DATE ?? r.so_date),
        bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
        b_type: '',
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        status: normStatus(r.STATUS ?? r.status),
        rate: num(r.RATE ?? r.rate),
        code: normCode(r.CODE ?? r.code),
        name: String(r.NAME ?? r.name ?? '').trim(),
        city: '',
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        so_qty: 0,
        so_wgt: 0,
        do_qty: num(r.QNTY ?? r.qnty),
        do_wgt: num(r.WEIGHT ?? r.weight),
        sl_qty: 0,
        sl_wgt: 0,
        bk_code: normCode(r.BK_CODE ?? r.bk_code),
        bk_name: String(r.B_NAME ?? r.b_name ?? '').trim(),
        god_code: normCode(r.GOD_CODE ?? r.god_code),
        rake_truck: '',
        delv_city: '',
        d_e: '',
        clear_yn: '',
        delv_date: '',
        pmt_date: '',
        pmt_due_days: 0,
        m_type: 2,
        sale_type: String(r.TYPE ?? r.type ?? 'DO').trim().toUpperCase() || 'DO',
        valid_date: String(r.VALID_DATE ?? r.valid_date ?? '').trim(),
      });
    }

    let rows = applyCommonFilters(
      temp.map((r) => ({ ...r, clear_yn: r.clear_yn || 'N' })),
      opts,
      { requireClear: false }
    );

    if (qIgnore >= 0 && openSo.size) {
      rows = rows.filter((r) => openSo.has(r.so_no) || Number(opts.so_no) === r.so_no);
    }

    if (qIgnore !== 0) {
      const bal = new Map();
      for (const r of rows) {
        const k = joinKey(r.so_no, r.item_code, r.status, 0, false);
        if (!bal.has(k)) bal.set(k, { oqty: 0, rqty: 0, owgt: 0, rwgt: 0, so_no: r.so_no });
        const b = bal.get(k);
        b.oqty += num(r.so_qty);
        b.rqty += num(r.sl_qty);
        b.owgt += num(r.so_wgt);
        b.rwgt += num(r.sl_wgt);
      }
      const keepSo = new Set();
      for (const b of bal.values()) {
        const bqty = b.oqty - b.rqty;
        const bwgt = b.owgt - b.rwgt;
        const ok = sorderQw === 'Q' ? bqty > qIgnore : bwgt > qIgnore;
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
      const rt = a.rate - b.rate;
      if (rt) return rt;
      const mt = a.m_type - b.m_type;
      if (mt) return mt;
      return String(a.so_date || '').localeCompare(String(b.so_date || ''));
    });

    for (const r of rows) {
      r.bqty = num(r.so_qty) - num(r.sl_qty);
      r.bwgt = num(r.so_wgt) - num(r.sl_wgt);
      r.bqty_so_sl = r.bqty;
      r.bwgt_so_sl = r.bwgt;
      r.bqty_so_do = num(r.so_qty) - num(r.do_qty);
      r.bwgt_so_do = num(r.so_wgt) - num(r.do_wgt);
    }

    return {
      head_name: 'PENDING SALES ORDER LIST',
      report_type: 'so-do-sale',
      sorder_q_w: sorderQw,
      msc,
      s_date: formatDateOut(opts.sdt),
      e_date: formatDateOut(opts.edt),
      rows,
      grand: sumTotals(rows, [
        'so_qty',
        'do_qty',
        'sl_qty',
        'bqty',
        'bqty_so_sl',
        'bqty_so_do',
        'so_wgt',
        'do_wgt',
        'sl_wgt',
        'bwgt',
        'bwgt_so_sl',
        'bwgt_so_do',
      ]),
    };
  }

  return { fetchPendingSummary, fetchPendingDetail, fetchPendingSoDoSale };
}

module.exports = { createSalesOrderPending };
