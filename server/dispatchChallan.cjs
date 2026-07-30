/**
 * Dispatch Challan entry — VFP DO FORM dcadd WITH 'DC' / 'DR' → SALE.TYPE = 'DC' | 'DR'.
 * Rights: USERS.F11 (access/add/edit/delete) — user master label "Gate Pass Dispatch".
 * VFP source: forms/dcadd.scx + prg/dchalan.prg.
 */

'use strict';

const DC_TYPES = new Set(['DC', 'DR']);

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normCode(v) {
  return String(v ?? '').trim().toUpperCase();
}

/** VFP dcadd grid status — only B / K / H allowed. */
function normStatus(v) {
  const s = String(v ?? 'B').trim().toUpperCase();
  return ['B', 'K', 'H'].includes(s) ? s : 'B';
}

function normDcType(v) {
  const t = String(v ?? 'DC').trim().toUpperCase();
  return DC_TYPES.has(t) ? t : null;
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

/**
 * VFP dcadd amountcal:
 *  weight ≠ 0 → G_WGTKQ='Q' ? WEIGHT×RATE : WEIGHT×RATE/100
 *  weight = 0 → QNTY×RATE
 */
function calcLineAmount(qnty, weight, rate, wgtKq = 'K') {
  const w = num(weight);
  const r = num(rate);
  if (w !== 0) {
    if (String(wgtKq || 'K').trim().toUpperCase() === 'Q') {
      return Math.round(w * r * 100) / 100;
    }
    return Math.round(((w * r) / 100) * 100) / 100;
  }
  return Math.round(num(qnty) * r * 100) / 100;
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

function createDispatchChallan({ runQuery, parseDateOnly, withCompTransaction, runHubQuery }) {
  if (typeof runQuery !== 'function' || typeof parseDateOnly !== 'function') {
    throw new Error('createDispatchChallan requires runQuery and parseDateOnly');
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

  /** USERS.F11 — VFP usertst FORMNAME='DCHALAN'. */
  async function fetchDchalanUserF11String(user_name) {
    const u = String(user_name || '').trim().toUpperCase();
    if (!u) return { f11: '', source: 'empty_user' };
    const tables = ['GRAINFAS.USERS', 'USERS'];
    for (const t of tables) {
      try {
        const rows = await queryHub(
          `SELECT F11 FROM ${t} WHERE UPPER(TRIM(USER_NAME)) = :u AND ROWNUM = 1`,
          { u },
          { suppressDbErrorLog: true }
        );
        if (rows?.length) {
          const raw = rows[0].F11 ?? rows[0].f11;
          return { f11: raw != null ? String(raw).trim() : '', source: t };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* ignore optional schema/table */
        }
      }
    }
    return { f11: '', source: 'none' };
  }

  function dchalanPermissionsFromF11(f11) {
    const str = String(f11 ?? '').trim();
    const padded = (str || '0000').padEnd(4, '0').slice(0, 4);
    const bit = (i) => padded.charAt(i) === '1';
    return {
      canOpen: bit(0),
      canAdd: bit(1),
      canEdit: bit(2),
      canDelete: bit(3),
      flags: 'f11',
    };
  }

  async function fetchDchalanUserPermissions(user_name) {
    const { f11, source } = await fetchDchalanUserF11String(user_name);
    return { f11, source, ...dchalanPermissionsFromF11(f11) };
  }

  async function assertDchalanPermission(user_name, comp_uid, kind) {
    const perms = await fetchDchalanUserPermissions(user_name);
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

  /**
   * VFP G_SORDER_TYPE from GRAINFAS.DEFVALUE.SALE_ORDER_TYPE.
   * 'C' → Cust/Brok help + order lookup keyed on customer (CODE, SUBSTR='C');
   * 'B' → keyed on broker (BK_CODE, SUBSTR='B'). Defaults to 'B'.
   */
  async function fetchSaleOrderType(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sources = [
      'SELECT NVL(SALE_ORDER_TYPE, \' \') AS SALE_ORDER_TYPE FROM GRAINFAS.DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1',
      'SELECT NVL(SALE_ORDER_TYPE, \' \') AS SALE_ORDER_TYPE FROM DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1',
    ];
    for (const sql of sources) {
      try {
        const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
        if (rows?.length) {
          const v = String(rows[0].SALE_ORDER_TYPE ?? rows[0].sale_order_type ?? '')
            .trim()
            .toUpperCase()
            .slice(0, 1);
          return v === 'C' ? 'C' : 'B';
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* ignore optional schema/column */
        }
      }
    }
    return 'B';
  }

  async function fetchSalesOrderHelpSettings(comp_code, comp_uid) {
    const cc = Number(comp_code) || 0;
    const sources = [
      `SELECT NVL(SALE_ORDER_TYPE, 'B') AS SALE_ORDER_TYPE,
              NVL(SO_RATE_CHK, 'N') AS SO_RATE_CHK,
              NVL(ORDER_QW, 'Q') AS ORDER_QW
       FROM GRAINFAS.DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
      `SELECT NVL(SALE_ORDER_TYPE, 'B') AS SALE_ORDER_TYPE,
              NVL(SO_RATE_CHK, 'N') AS SO_RATE_CHK,
              NVL(ORDER_QW, 'Q') AS ORDER_QW
       FROM DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
    ];
    for (const sql of sources) {
      try {
        const rows = await runQuery(sql, { comp_code: cc }, comp_uid);
        if (rows?.length) {
          const row = rows[0];
          return {
            saleOrderType:
              String(row.SALE_ORDER_TYPE ?? row.sale_order_type ?? 'B').trim().toUpperCase() === 'C'
                ? 'C'
                : 'B',
            soRateCheck:
              String(row.SO_RATE_CHK ?? row.so_rate_chk ?? 'N').trim().toUpperCase() === 'Y'
                ? 'Y'
                : 'N',
            sorderQw:
              String(row.ORDER_QW ?? row.order_qw ?? 'Q').trim().toUpperCase() === 'Q'
                ? 'Q'
                : 'W',
          };
        }
      } catch (err) {
        if (!isLoginOptionalTableError(err)) {
          /* try company-local DEFVALUE */
        }
      }
    }
    return { saleOrderType: 'B', soRateCheck: 'N', sorderQw: 'Q' };
  }

  /**
   * VFP dcadd SO help — open SORDER balance after subtracting DC and adding DR.
   * Customer/broker matching and rate grouping come from GRAINFAS.DEFVALUE.
   */
  async function fetchSalesOrderHelp(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const itemCode = Number(opts.item_code) || 0;
    const masterCode = normCode(opts.master_code);
    if (!masterCode) {
      const err = new Error('Select Cust/Brok before SO.No. help.');
      err.status = 400;
      throw err;
    }
    if (!itemCode) {
      const err = new Error('Select an item before SO.No. help.');
      err.status = 400;
      throw err;
    }

    const settings = await fetchSalesOrderHelpSettings(cc, comp_uid);
    const masterColumn = settings.saleOrderType === 'C' ? 'CODE' : 'BK_CODE';
    const rateSelect =
      settings.soRateCheck === 'Y'
        ? 'NVL(A.RATE, 0) AS RATE'
        : 'MAX(NVL(A.RATE, 0)) AS RATE';
    const rateGroup = settings.soRateCheck === 'Y' ? ', NVL(A.RATE, 0)' : '';
    const binds = { comp_code: cc, master_code: masterCode, item_code: itemCode };

    const orderRows = await runQuery(
      `SELECT A.SO_NO, MAX(A.SO_DATE) AS SO_DATE, A.ITEM_CODE,
              TRIM(NVL(A.STATUS, 'K')) AS STATUS, ${rateSelect},
              SUM(NVL(A.QNTY, 0)) AS SOQTY,
              SUM(NVL(A.WEIGHT, 0)) AS SOWGT
       FROM SORDER A
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.TYPE) = 'SO'
         AND TRIM(A.${masterColumn}) = TRIM(:master_code)
         AND A.ITEM_CODE = :item_code
         AND NVL(A.CLEAR_YN, 'N') <> 'Y'
       GROUP BY A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'K'))${rateGroup}
       ORDER BY A.SO_NO`,
      binds,
      comp_uid
    );

    const usedRateSelect =
      settings.soRateCheck === 'Y'
        ? 'NVL(A.RATE, 0) AS RATE'
        : 'MAX(NVL(A.RATE, 0)) AS RATE';
    const usedRateGroup = settings.soRateCheck === 'Y' ? ', NVL(A.RATE, 0)' : '';
    const usedRows = await runQuery(
      `SELECT A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'K')) AS STATUS,
              ${usedRateSelect},
              SUM(CASE WHEN TRIM(A.TYPE) = 'DR' THEN -NVL(A.QNTY, 0) ELSE NVL(A.QNTY, 0) END) AS SLQTY,
              SUM(CASE WHEN TRIM(A.TYPE) = 'DR' THEN -NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) END) AS SLWGT
       FROM SALE A
       WHERE A.COMP_CODE = :comp_code
         AND TRIM(A.${masterColumn}) = TRIM(:master_code)
         AND A.ITEM_CODE = :item_code
         AND TRIM(A.TYPE) IN ('DC', 'DR')
         AND NVL(A.SO_NO, 0) <> 0
       GROUP BY A.SO_NO, A.ITEM_CODE, TRIM(NVL(A.STATUS, 'K'))${usedRateGroup}`,
      binds,
      comp_uid
    );

    const keyFor = (row) => {
      const base = [
        String(row.SO_NO ?? row.so_no ?? '').trim(),
        Number(row.ITEM_CODE ?? row.item_code ?? 0) || 0,
        normStatus(row.STATUS ?? row.status),
      ];
      if (settings.soRateCheck === 'Y') base.push(num(row.RATE ?? row.rate).toFixed(2));
      return base.join('|');
    };
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
          so_no: String(row.SO_NO ?? row.so_no ?? '').trim(),
          so_date: formatDateOut(row.SO_DATE ?? row.so_date),
          item_code: Number(row.ITEM_CODE ?? row.item_code ?? 0) || 0,
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
      .filter((row) => Number(row.so_no) >= 1)
      .filter((row) =>
        settings.sorderQw === 'Q' ? row.balance_qnty > 0 : row.balance_weight > 0
      );
  }

  /**
   * VFP DISPSTK.Click — browse non-zero LOTSTOCK balances as of the challan date.
   * The selected row supplies Item/Lot/BKH/B.No/Godown/Supplier and the receipt rate.
   */
  async function fetchLotStockHelp(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const billDate = formatDateBind(opts.bill_date);
    const itemCode = Number(opts.item_code) || 0;
    const supCode = normCode(opts.sup_code);
    const remarksFilter = String(opts.remarks ?? '').trim().toUpperCase();
    const binds = { comp_code: cc };
    let extra = '';
    if (billDate) {
      binds.bill_date = billDate;
      extra += " AND A.VR_DATE <= TRUNC(TO_DATE(:bill_date, 'DD-MM-YYYY'))";
    }
    if (itemCode) {
      binds.item_code = itemCode;
      extra += ' AND A.ITEM_CODE = :item_code';
    }
    if (supCode) {
      binds.sup_code = supCode;
      extra += ' AND TRIM(A.SUP_CODE) = TRIM(:sup_code)';
    }

    let negStockQw = 'Q';
    try {
      const settings = await runQuery(
        `SELECT NVL(NEG_STOCK_QW, 'Q') AS NEG_STOCK_QW
         FROM DEFVALUE WHERE COMP_CODE = :comp_code AND ROWNUM = 1`,
        { comp_code: cc },
        comp_uid
      );
      negStockQw = String(settings?.[0]?.NEG_STOCK_QW ?? settings?.[0]?.neg_stock_qw ?? 'Q')
        .trim()
        .toUpperCase();
    } catch {
      negStockQw = 'Q';
    }
    binds.neg_stock_qw = negStockQw === 'Q' ? 'Q' : 'W';

    const rows = await runQuery(
      `SELECT
         MAX(A.B_NO) AS B_NO,
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
         MAX(TRIM(NVL(A.COST_CODE, ' '))) AS COST_CODE,
         MAX(TRIM(NVL(A.REMARKS, ' '))) AS REMARKS
       FROM LOTSTOCK A
       JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
       LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(C.CODE)
       WHERE A.COMP_CODE = :comp_code${extra}
       GROUP BY A.ITEM_CODE, A.LOT, TRIM(NVL(A.STATUS, 'B')), TRIM(NVL(A.GOD_CODE, ' '))
       HAVING SUM(
         CASE WHEN :neg_stock_qw = 'Q'
           THEN CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.QNTY, 0) ELSE -NVL(A.QNTY, 0) END
           ELSE CASE WHEN TRIM(A.E_TYPE) = 'R' THEN NVL(A.WEIGHT, 0) ELSE -NVL(A.WEIGHT, 0) END
         END
       ) <> 0
       ORDER BY A.ITEM_CODE, A.LOT, STATUS, GOD_CODE`,
      binds,
      comp_uid
    );

    const wgtKq = await fetchWgtKq(cc, comp_uid);
    const mapped = (rows || []).map((r, idx) => {
      const receiptWeight = num(r.RWGT ?? r.rwgt);
      const receiptAmount = num(r.RAMT ?? r.ramt);
      const rate = receiptWeight
        ? Math.round((wgtKq === 'K' ? (receiptAmount / receiptWeight) * 100 : receiptAmount / receiptWeight) * 100) / 100
        : 0;
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
        receipt_qnty: num(r.RQTY ?? r.rqty),
        issue_qnty: num(r.SQTY ?? r.sqty),
        balance_qnty: num(r.BQTY ?? r.bqty),
        balance_weight: num(r.BWGT ?? r.bwgt),
        rate,
        cost_code: normCode(r.COST_CODE ?? r.cost_code),
        remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
      };
    });
    if (!remarksFilter) return mapped;
    return mapped.filter((r) => String(r.remarks || '').toUpperCase().includes(remarksFilter));
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
    if (!rows?.[0]) {
      const err = new Error(`Item ${ic} not found in item master.`);
      err.status = 400;
      throw err;
    }
    return true;
  }

  /** VFP mainform: SELECT MAX(BILL_NO)+1 FROM SALE WHERE COMP_CODE AND TYPE. */
  async function fetchNextBillNo(comp_code, comp_uid, dcType) {
    const cc = Number(comp_code) || 0;
    const rows = await runQuery(
      `SELECT NVL(MAX(BILL_NO), 0) + 1 AS NEXT_NO FROM SALE WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)`,
      { comp_code: cc, type: dcType },
      comp_uid
    );
    return Number(rows?.[0]?.NEXT_NO ?? rows?.[0]?.next_no ?? 1) || 1;
  }

  /** VFP DR ch_no LostFocus — Ref.No. must exist on a saved DC. */
  async function assertDcRefExists(comp_code, comp_uid, ch_no) {
    const cc = Number(comp_code) || 0;
    const ref = String(ch_no ?? '').trim();
    if (!ref) {
      const err = new Error('Ref. Challan No. is required for DC Return.');
      err.status = 400;
      throw err;
    }
    const rows = await runQuery(
      `SELECT COUNT(*) AS CNT FROM SALE
       WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = 'DC' AND TRIM(TO_CHAR(CH_NO)) = TRIM(:ch_no)`,
      { comp_code: cc, ch_no: ref },
      comp_uid
    );
    const cnt = Number(rows?.[0]?.CNT ?? rows?.[0]?.cnt ?? 0) || 0;
    if (!cnt) {
      const err = new Error(`Ref. Challan No. "${ref}" not found on any Dispatch Challan.`);
      err.status = 400;
      throw err;
    }
    return ref;
  }

  async function loadDispatchChallan(comp_code, comp_uid, dcType, bill_no, b_type) {
    const cc = Number(comp_code) || 0;
    const no = Number(bill_no) || 0;
    if (!no) {
      const err = new Error('Challan number is required.');
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
        NVL(C.TEL_NO_O, ' ') AS PARTY_TEL,
        NVL(C.GST_NO, ' ') AS PARTY_GST,
        NVL(C.PAN, ' ') AS PARTY_PAN,
        NVL(C.STATE, ' ') AS PARTY_STATE,
        NVL(C.STATE_CODE, ' ') AS PARTY_STATE_CODE,
        NVL(C.OWN_NAME1, ' ') AS PARTY_CONTACT,
        D.NAME AS BK_NAME,
        NVL(D.ADD1, ' ') AS BK_ADD1,
        NVL(D.ADD2, ' ') AS BK_ADD2,
        NVL(D.CITY, ' ') AS BK_CITY,
        NVL(D.TEL_NO_O, ' ') AS BK_TEL,
        G.GOD_NAME,
        S.NAME AS SUP_NAME
      FROM SALE A
      LEFT JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND A.BK_CODE = D.CODE
      LEFT JOIN GODOWN G ON A.COMP_CODE = G.COMP_CODE AND A.GOD_CODE = G.GOD_CODE
      LEFT JOIN MASTER S ON A.COMP_CODE = S.COMP_CODE AND A.SUP_CODE = S.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) = TRIM(:type)
        AND A.BILL_NO = :bill_no
        AND NVL(TRIM(A.B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')
      ORDER BY A.TRN_NO`;
    const rows = await runQuery(sql, { comp_code: cc, type: dcType, bill_no: no, b_type: bt }, comp_uid);
    if (!rows?.length) {
      const err = new Error(`${dcType === 'DR' ? 'DC Return' : 'Dispatch Challan'} ${no} not found.`);
      err.status = 404;
      throw err;
    }
    const h = rows[0];
    const header = {
      type: dcType,
      bill_no: Number(h.BILL_NO ?? h.bill_no ?? 0) || no,
      b_type: String(h.B_TYPE ?? h.b_type ?? 'N').trim() || 'N',
      bill_date: formatDateOut(h.BILL_DATE ?? h.bill_date),
      v_date: formatDateOut(h.V_DATE ?? h.v_date),
      code: normCode(h.CODE ?? h.code),
      party_name: String(h.PARTY_NAME ?? h.party_name ?? '').trim(),
      party_add1: String(h.PARTY_ADD1 ?? h.party_add1 ?? '').trim(),
      party_add2: String(h.PARTY_ADD2 ?? h.party_add2 ?? '').trim(),
      party_add3: String(h.PARTY_ADD3 ?? h.party_add3 ?? '').trim(),
      party_city: String(h.PARTY_CITY ?? h.party_city ?? '').trim(),
      party_tel: String(h.PARTY_TEL ?? h.party_tel ?? '').trim(),
      party_gst: String(h.PARTY_GST ?? h.party_gst ?? '').trim(),
      party_pan: String(h.PARTY_PAN ?? h.party_pan ?? '').trim(),
      party_state: String(h.PARTY_STATE ?? h.party_state ?? '').trim(),
      party_state_code: String(h.PARTY_STATE_CODE ?? h.party_state_code ?? '').trim(),
      party_contact: String(h.PARTY_CONTACT ?? h.party_contact ?? '').trim(),
      bk_code: normCode(h.BK_CODE ?? h.bk_code),
      bk_name: String(h.BK_NAME ?? h.bk_name ?? '').trim(),
      bk_add1: String(h.BK_ADD1 ?? h.bk_add1 ?? '').trim(),
      bk_add2: String(h.BK_ADD2 ?? h.bk_add2 ?? '').trim(),
      bk_city: String(h.BK_CITY ?? h.bk_city ?? '').trim(),
      bk_tel: String(h.BK_TEL ?? h.bk_tel ?? '').trim(),
      ch_no: String(h.CH_NO ?? h.ch_no ?? '').trim(),
      gr_no: String(h.GR_NO ?? h.gr_no ?? '').trim(),
      truck_no: String(h.TRUCK_NO ?? h.truck_no ?? '').trim(),
      tpt: String(h.TPT ?? h.tpt ?? '').trim(),
      form: String(h.FORM ?? h.form ?? '').trim(),
      remarks: String(h.REMARKS ?? h.remarks ?? '').trim(),
      mod_reason: String(h.MOD_REASON ?? h.mod_reason ?? '').trim(),
      bill_amt: num(h.BILL_AMT ?? h.bill_amt),
    };
    const lines = rows.map((r, idx) => ({
      trn_no: Number(r.TRN_NO ?? r.trn_no ?? idx + 1) || idx + 1,
      item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
      item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      hsn_code: String(r.HSN_CODE ?? r.hsn_code ?? '').trim(),
      so_no: String(r.SO_NO ?? r.so_no ?? '').trim(),
      lot: String(r.LOT ?? r.lot ?? '').trim(),
      status: normStatus(r.STATUS ?? r.status),
      b_no: String(r.B_NO ?? r.b_no ?? '').trim(),
      god_code: normCode(r.GOD_CODE ?? r.god_code),
      god_name: String(r.GOD_NAME ?? r.god_name ?? '').trim(),
      sup_code: normCode(r.SUP_CODE ?? r.sup_code),
      sup_name: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
      cost_code: normCode(r.COST_CODE ?? r.cost_code),
      marka: String(r.MARKA ?? r.marka ?? '').trim(),
      qnty: num(r.QNTY ?? r.qnty),
      packing: num(r.PACKING ?? r.packing),
      weight: num(r.WEIGHT ?? r.weight),
      rate: num(r.RATE ?? r.rate),
      amount: num(r.AMOUNT ?? r.amount),
      sup_date: formatDateOut(r.SUP_DATE ?? r.sup_date),
    }));
    return { ok: true, header, lines };
  }

  async function listDispatchChallans(comp_code, comp_uid, dcType, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc, type: dcType };
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
      SELECT BILL_NO, BILL_DATE, CODE, PARTY_NAME, CH_NO, TRUCK_NO, LINE_COUNT, TOT_QNTY, TOT_WEIGHT, TOT_AMT FROM (
        SELECT TRUNC(A.BILL_DATE) AS BILL_DATE, A.BILL_NO, A.CODE, B.NAME AS PARTY_NAME,
               MAX(TRIM(TO_CHAR(A.CH_NO))) AS CH_NO, MAX(A.TRUCK_NO) AS TRUCK_NO,
               COUNT(*) AS LINE_COUNT, SUM(NVL(A.QNTY, 0)) AS TOT_QNTY,
               SUM(NVL(A.WEIGHT, 0)) AS TOT_WEIGHT, SUM(NVL(A.AMOUNT, 0)) AS TOT_AMT
        FROM SALE A
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
      ch_no: String(r.CH_NO ?? r.ch_no ?? '').trim(),
      truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
      line_count: Number(r.LINE_COUNT ?? r.line_count ?? 0) || 0,
      tot_qnty: num(r.TOT_QNTY ?? r.tot_qnty),
      tot_weight: num(r.TOT_WEIGHT ?? r.tot_weight),
      tot_amt: num(r.TOT_AMT ?? r.tot_amt),
    }));
  }

  /** VFP dcchk (dchalan.prg DCCHK) — detail checklist for the period. */
  async function fetchChecklist(comp_code, comp_uid, dcType, opts = {}) {
    const cc = Number(comp_code) || 0;
    let sbno = Number(opts.sbno);
    let ebno = Number(opts.ebno);
    if (!Number.isFinite(sbno)) sbno = 0;
    if (!Number.isFinite(ebno)) ebno = 0;
    if (sbno === 0 && ebno === 0) {
      sbno = 0;
      ebno = 999999;
    }
    const binds = {
      comp_code: cc,
      type: dcType,
      sdt: formatDateBind(opts.sdt) || formatDateBind(new Date()),
      edt: formatDateBind(opts.edt) || formatDateBind(new Date()),
      sbno,
      ebno,
    };
    let where =
      'A.COMP_CODE = :comp_code AND TRIM(A.TYPE) = TRIM(:type) ' +
      "AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY')) AND TRUNC(TO_DATE(:edt, 'DD-MM-YYYY')) " +
      'AND A.BILL_NO BETWEEN :sbno AND :ebno';

    const partyCode = normCode(opts.code || opts.mcode);
    if (partyCode) {
      binds.code = partyCode;
      where += ' AND TRIM(A.CODE) = TRIM(:code)';
    }
    const itemCode = Number(opts.item_code || opts.icode) || 0;
    if (itemCode) {
      binds.item_code = itemCode;
      where += ' AND A.ITEM_CODE = :item_code';
    }
    const supCode = normCode(opts.sup_code || opts.scode);
    if (supCode) {
      binds.sup_code = supCode;
      where += ' AND TRIM(A.SUP_CODE) = TRIM(:sup_code)';
    }
    const bkCode = normCode(opts.bk_code || opts.bcode);
    if (bkCode) {
      binds.bk_code = bkCode;
      where += ' AND TRIM(A.BK_CODE) = TRIM(:bk_code)';
    }
    const mlc = String(opts.mlc || opts.l_c || '').trim().toUpperCase();
    if (mlc) {
      binds.mlc = mlc;
      where += ' AND UPPER(TRIM(NVL(B.L_C, \'\'))) = :mlc';
    }
    const city = String(opts.city || opts.mcity || '').trim().toUpperCase();
    if (city) {
      binds.city = city;
      where += ' AND UPPER(TRIM(NVL(B.CITY, \'\'))) = :city';
    }
    const bType = String(opts.b_type || opts.btype || '').trim().toUpperCase();
    if (bType) {
      binds.b_type = bType;
      where += ' AND UPPER(TRIM(NVL(A.B_TYPE, \'N\'))) = :b_type';
    }

    const sql = `
      SELECT
        TRUNC(A.BILL_DATE) AS BILL_DATE,
        A.BILL_NO,
        TRIM(NVL(A.B_TYPE, 'N')) AS B_TYPE,
        A.TRN_NO,
        TRUNC(A.V_DATE) AS V_DATE,
        TRIM(A.CODE) AS CODE,
        B.NAME AS PARTY_NAME,
        NVL(B.CITY, ' ') AS CITY,
        NVL(B.L_C, ' ') AS L_C,
        TRIM(NVL(A.BK_CODE, ' ')) AS BK_CODE,
        NVL(C.NAME, ' ') AS BK_NAME,
        TRIM(NVL(A.SUP_CODE, ' ')) AS SUP_CODE,
        NVL(D.NAME, ' ') AS SUP_NAME,
        A.ITEM_CODE,
        E.ITEM_NAME,
        TRIM(NVL(A.STATUS, 'B')) AS STATUS,
        TRIM(TO_CHAR(NVL(A.LOT, 0))) AS LOT,
        TRIM(NVL(A.GOD_CODE, ' ')) AS GOD_CODE,
        NVL(A.QNTY, 0) AS QNTY,
        NVL(A.PACKING, 0) AS PACKING,
        NVL(A.WEIGHT, 0) AS WEIGHT,
        NVL(A.RATE, 0) AS RATE,
        NVL(A.AMOUNT, 0) AS AMOUNT,
        NVL(A.BILL_AMT, 0) AS BILL_AMT,
        NVL(A.MARKA, ' ') AS MARKA,
        NVL(A.TRUCK_NO, ' ') AS TRUCK_NO,
        NVL(A.TPT, ' ') AS TPT,
        TRIM(NVL(TO_CHAR(A.GR_NO), ' ')) AS GR_NO,
        NVL(A.REMARKS, ' ') AS REMARKS
      FROM SALE A
      JOIN MASTER B ON A.COMP_CODE = B.COMP_CODE AND A.CODE = B.CODE
      JOIN ITEMMAST E ON A.COMP_CODE = E.COMP_CODE AND A.ITEM_CODE = E.ITEM_CODE
      LEFT JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND TRIM(A.BK_CODE) = TRIM(C.CODE)
      LEFT JOIN MASTER D ON A.COMP_CODE = D.COMP_CODE AND TRIM(A.SUP_CODE) = TRIM(D.CODE)
      WHERE ${where}
      ORDER BY A.BILL_DATE, A.BILL_NO, A.B_TYPE, A.TRN_NO`;

    const rows = await runQuery(sql, binds, comp_uid);
    const mapped = (rows || []).map((r) => {
      const status = normStatus(r.STATUS ?? r.status);
      const qnty = num(r.QNTY ?? r.qnty);
      return {
        bill_date: formatDateOut(r.BILL_DATE ?? r.bill_date),
        bill_no: Number(r.BILL_NO ?? r.bill_no ?? 0) || 0,
        b_type: String(r.B_TYPE ?? r.b_type ?? 'N').trim() || 'N',
        trn_no: Number(r.TRN_NO ?? r.trn_no ?? 0) || 0,
        v_date: formatDateOut(r.V_DATE ?? r.v_date),
        code: normCode(r.CODE ?? r.code),
        party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
        city: String(r.CITY ?? r.city ?? '').trim(),
        l_c: String(r.L_C ?? r.l_c ?? '').trim().toUpperCase(),
        bk_code: normCode(r.BK_CODE ?? r.bk_code),
        bk_name: String(r.BK_NAME ?? r.bk_name ?? '').trim(),
        sup_code: normCode(r.SUP_CODE ?? r.sup_code),
        sup_name: String(r.SUP_NAME ?? r.sup_name ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        status,
        lot: String(r.LOT ?? r.lot ?? '').trim(),
        god_code: normCode(r.GOD_CODE ?? r.god_code),
        qnty,
        packing: num(r.PACKING ?? r.packing),
        weight: num(r.WEIGHT ?? r.weight),
        rate: num(r.RATE ?? r.rate),
        amount: num(r.AMOUNT ?? r.amount),
        bill_amt: num(r.BILL_AMT ?? r.bill_amt),
        marka: String(r.MARKA ?? r.marka ?? '').trim(),
        truck_no: String(r.TRUCK_NO ?? r.truck_no ?? '').trim(),
        tpt: String(r.TPT ?? r.tpt ?? '').trim(),
        gr_no: String(r.GR_NO ?? r.gr_no ?? '').trim(),
        remarks: String(r.REMARKS ?? r.remarks ?? '').trim(),
        bags: status === 'B' ? qnty : 0,
        katta: status === 'K' ? qnty : 0,
        hkatta: status === 'H' ? qnty : 0,
        sr_no: 1,
      };
    });

    const headName =
      dcType === 'DR'
        ? `DISPATCH CHALLAN RETURN FROM ${binds.sdt} TO ${binds.edt}`
        : dcType === 'EC'
          ? `EXPORT CHALLAN LIST FROM ${binds.sdt} TO ${binds.edt}`
          : `DISPATCH CHALLAN LIST FROM ${binds.sdt} TO ${binds.edt}`;

    const totals = mapped.reduce(
      (t, r) => ({
        qnty: t.qnty + r.qnty,
        bags: t.bags + r.bags,
        katta: t.katta + r.katta,
        hkatta: t.hkatta + r.hkatta,
        weight: t.weight + r.weight,
        amount: t.amount + r.amount,
      }),
      { qnty: 0, bags: 0, katta: 0, hkatta: 0, weight: 0, amount: 0 }
    );

    return { ok: true, head_name: headName, rows: mapped, totals };
  }

  async function fetchChecklistCities(comp_code, comp_uid) {
    const rows = await runQuery(
      `SELECT TRIM(CITY) AS CITY
       FROM MASTER
       WHERE COMP_CODE = :comp_code
         AND TRIM(NVL(CITY, ' ')) IS NOT NULL
       GROUP BY TRIM(CITY)
       ORDER BY 1`,
      { comp_code: Number(comp_code) || 0 },
      comp_uid
    ).catch(() => []);
    return (rows || [])
      .map((r) => {
        const city = String(r.CITY ?? r.city ?? '').trim();
        return city ? { city } : null;
      })
      .filter(Boolean);
  }

  /**
   * VFP dcpnd (dchalan.prg DCPND) — pending challans: DC qty grouped by CH_NO
   * minus SL / CN / CH / DR against the same CH_NO. Rows with balance > 0.
   */
  async function fetchPending(comp_code, comp_uid, opts = {}) {
    const cc = Number(comp_code) || 0;
    const binds = { comp_code: cc };
    let extra = '';
    if (opts.sdt) {
      const sdt = formatDateBind(opts.sdt);
      if (sdt) {
        binds.sdt = sdt;
        extra += " AND TRUNC(A.BILL_DATE) >= TRUNC(TO_DATE(:sdt, 'DD-MM-YYYY'))";
      }
    }
    if (opts.edt) {
      const edt = formatDateBind(opts.edt);
      if (edt) {
        binds.edt = edt;
        extra += " AND TRUNC(A.BILL_DATE) <= TRUNC(TO_DATE(:edt, 'DD-MM-YYYY'))";
      }
    }
    const partyCode = normCode(opts.code);
    if (partyCode) {
      binds.code = partyCode;
      extra += ' AND TRIM(A.CODE) = TRIM(:code)';
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
        SUM(CASE WHEN TRIM(A.TYPE) = 'DC' THEN NVL(A.QNTY, 0) ELSE 0 END) AS DC_QNTY,
        SUM(CASE WHEN TRIM(A.TYPE) <> 'DC' THEN NVL(A.QNTY, 0) ELSE 0 END) AS OTH_QNTY,
        SUM(CASE WHEN TRIM(A.TYPE) = 'DC' THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS DC_WEIGHT,
        SUM(CASE WHEN TRIM(A.TYPE) <> 'DC' THEN NVL(A.WEIGHT, 0) ELSE 0 END) AS OTH_WEIGHT
      FROM SALE A
      JOIN ITEMMAST B ON A.COMP_CODE = B.COMP_CODE AND A.ITEM_CODE = B.ITEM_CODE
      JOIN MASTER C ON A.COMP_CODE = C.COMP_CODE AND A.CODE = C.CODE
      WHERE A.COMP_CODE = :comp_code
        AND TRIM(A.TYPE) IN ('DC', 'SL', 'CN', 'CH', 'DR')
        AND NVL(A.CH_NO, 0) <> 0${extra}
      GROUP BY TRIM(TO_CHAR(A.CH_NO)), TRIM(A.CODE), C.NAME, A.ITEM_CODE, B.ITEM_NAME, TRIM(TO_CHAR(NVL(A.LOT, 0))), TRIM(NVL(A.STATUS, 'B'))
      HAVING SUM(CASE WHEN TRIM(A.TYPE) = 'DC' THEN NVL(A.QNTY, 0) ELSE 0 END)
           - SUM(CASE WHEN TRIM(A.TYPE) <> 'DC' THEN NVL(A.QNTY, 0) ELSE 0 END) > 0
      ORDER BY 1, 4`;
    const rows = await runQuery(sql, binds, comp_uid);
    return (rows || []).map((r) => {
      const dcQ = num(r.DC_QNTY ?? r.dc_qnty);
      const othQ = num(r.OTH_QNTY ?? r.oth_qnty);
      const dcW = num(r.DC_WEIGHT ?? r.dc_weight);
      const othW = num(r.OTH_WEIGHT ?? r.oth_weight);
      return {
        ch_no: String(r.CH_NO ?? r.ch_no ?? '').trim(),
        code: normCode(r.CODE ?? r.code),
        party_name: String(r.PARTY_NAME ?? r.party_name ?? '').trim(),
        item_code: Number(r.ITEM_CODE ?? r.item_code ?? 0) || 0,
        item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
        lot: String(r.LOT ?? r.lot ?? '').trim(),
        status: normStatus(r.STATUS ?? r.status),
        dc_qnty: dcQ,
        oth_qnty: othQ,
        bal_qnty: Math.round((dcQ - othQ) * 1000) / 1000,
        dc_weight: dcW,
        oth_weight: othW,
        bal_weight: Math.round((dcW - othW) * 1000) / 1000,
      };
    });
  }

  function normalizeLine(ln, idx, wgtKq) {
    const line = {
      trn_no: Number(ln.trn_no ?? ln.TRN_NO ?? idx + 1) || idx + 1,
      item_code: Number(ln.item_code ?? ln.ITEM_CODE ?? 0) || 0,
      so_no: String(ln.so_no ?? ln.SO_NO ?? '').trim().slice(0, 20),
      lot: String(ln.lot ?? ln.LOT ?? '').trim().slice(0, 20),
      status: normStatus(ln.status ?? ln.STATUS),
      b_no: String(ln.b_no ?? ln.B_NO ?? '').trim().slice(0, 20),
      god_code: normCode(ln.god_code ?? ln.GOD_CODE).slice(0, 10),
      sup_code: normCode(ln.sup_code ?? ln.SUP_CODE).slice(0, 10),
      cost_code: normCode(ln.cost_code ?? ln.COST_CODE).slice(0, 10),
      marka: String(ln.marka ?? ln.MARKA ?? '').trim().slice(0, 30),
      qnty: num(ln.qnty ?? ln.QNTY),
      packing: num(ln.packing ?? ln.PACKING),
      weight: num(ln.weight ?? ln.WEIGHT),
      rate: num(ln.rate ?? ln.RATE),
      amount: num(ln.amount ?? ln.AMOUNT),
      sup_date: ln.sup_date ?? ln.SUP_DATE ?? null,
    };
    line.amount = calcLineAmount(line.qnty, line.weight, line.rate, wgtKq);
    return line;
  }

  async function saveDispatchChallan(comp_code, comp_year, comp_uid, body, req) {
    const user_name = resolveUserName(body, req);
    const mode = String(body.mode ?? 'new').trim().toLowerCase();
    await assertDchalanPermission(user_name, comp_uid, mode === 'edit' ? 'edit' : 'add');

    const dcType = normDcType(body.dc_type ?? body.type);
    if (!dcType) {
      const err = new Error("dc_type must be 'DC' or 'DR'.");
      err.status = 400;
      throw err;
    }
    const cc = Number(comp_code) || 0;
    const cy = Number(comp_year) || 0;
    const bdt = parseDateOnly(body.bill_date ?? body.BILL_DATE);
    if (!bdt) {
      const err = new Error('Challan date is required.');
      err.status = 400;
      throw err;
    }
    const vdt = parseDateOnly(body.v_date ?? body.V_DATE) || bdt;
    const party = normCode(body.code ?? body.CODE);
    if (!party) {
      const err = new Error('Party code is required.');
      err.status = 400;
      throw err;
    }
    await assertMasterCode(cc, party, comp_uid, 'Party');
    const bk = normCode(body.bk_code ?? body.BK_CODE);
    if (bk) await assertMasterCode(cc, bk, comp_uid, 'Broker');

    const wgtKq = await fetchWgtKq(cc, comp_uid);
    const linesIn = Array.isArray(body.lines) ? body.lines : [];
    const lines = linesIn.map((ln, idx) => normalizeLine(ln, idx, wgtKq)).filter((ln) => ln.item_code);
    if (!lines.length) {
      const err = new Error('Enter at least one item line.');
      err.status = 400;
      throw err;
    }
    for (const ln of lines) {
      await assertItemCode(cc, ln.item_code, comp_uid);
    }

    const b_type = String(body.b_type ?? 'N').trim().toUpperCase().slice(0, 1) || 'N';
    let bill_no = Number(body.bill_no ?? body.BILL_NO ?? 0) || 0;
    if (mode === 'new' || !bill_no) {
      bill_no = await fetchNextBillNo(cc, comp_uid, dcType);
    }

    // VFP: DC → CH_NO = BILL_NO (field disabled); DR → user-entered Ref.No. must exist on a DC.
    let ch_no;
    if (dcType === 'DC') {
      ch_no = bill_no;
    } else {
      const ref = await assertDcRefExists(cc, comp_uid, body.ch_no ?? body.CH_NO);
      ch_no = Number(ref) || 0;
    }

    const bill_amt = Math.round(lines.reduce((s, ln) => s + num(ln.amount), 0) * 100) / 100;
    const header = {
      gr_no: String(body.gr_no ?? body.GR_NO ?? '').trim().slice(0, 25),
      truck_no: String(body.truck_no ?? body.TRUCK_NO ?? '').trim().toUpperCase().slice(0, 25),
      tpt: String(body.tpt ?? body.TPT ?? '').trim().slice(0, 50),
      form: String(body.form ?? body.FORM ?? '').trim().slice(0, 20),
      remarks: String(body.remarks ?? body.REMARKS ?? '').trim().slice(0, 150),
      mod_reason: String(body.mod_reason ?? body.MOD_REASON ?? '').trim().slice(0, 100),
    };

    const user = String(body.user_name ?? body.USER_NAME ?? req?.user?.name ?? 'WEB').trim().slice(0, 10);
    const entDate = new Date();
    const entTime = `${String(entDate.getHours()).padStart(2, '0')}:${String(entDate.getMinutes()).padStart(2, '0')}`;

    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      // VFP mydel + re-insert
      await q(
        `DELETE FROM SALE
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
           AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
        { comp_code: cc, type: dcType, bill_no, b_type }
      );
      const ins = `
        INSERT INTO SALE (
          COMP_CODE, COMP_YEAR, TYPE, BILL_NO, B_TYPE, BILL_DATE, V_DATE, CODE,
          GR_NO, TRUCK_NO, TPT, FORM, BILL_AMT,
          ITEM_CODE, LOT, STATUS, B_NO, SUP_CODE, QNTY, WEIGHT, RATE, AMOUNT,
          GOD_CODE, TRN_NO, SUP_DATE, REMARKS, USER_NAME, ENT_DATE,
          CH_NO, BK_CODE, PACKING, SO_NO, MOD_REASON, MARKA, COST_CODE
        ) VALUES (
          :comp_code, :comp_year, :type, :bill_no, :b_type, :bill_date, :v_date, :code,
          :gr_no, :truck_no, :tpt, :form, :bill_amt,
          :item_code, :lot, :status, :b_no, :sup_code, :qnty, :weight, :rate, :amount,
          :god_code, :trn_no, :sup_date, :remarks, :user_name, :ent_date,
          :ch_no, :bk_code, :packing, :so_no, :mod_reason, :marka, :cost_code
        )`;
      for (let i = 0; i < lines.length; i += 1) {
        const ln = lines[i];
        const first = i === 0;
        // VFP dcadd: Val.Date (SUP_DATE) defaults to the challan date
        const supDate = parseDateOnly(ln.sup_date) || bdt;
        await q(ins, {
          comp_code: cc,
          comp_year: cy,
          type: dcType,
          bill_no,
          b_type,
          bill_date: bdt,
          v_date: vdt,
          code: party,
          gr_no: header.gr_no,
          truck_no: header.truck_no,
          tpt: header.tpt,
          form: header.form,
          // VFP: BILL_AMT stored on first line only
          bill_amt: first ? bill_amt : 0,
          item_code: ln.item_code,
          lot: ln.lot,
          status: ln.status,
          b_no: ln.b_no,
          sup_code: ln.sup_code,
          qnty: ln.qnty,
          weight: ln.weight,
          rate: ln.rate,
          amount: ln.amount,
          god_code: ln.god_code,
          trn_no: ln.trn_no,
          sup_date: supDate,
          remarks: header.remarks,
          user_name: user,
          ent_date: entDate,
          ch_no,
          bk_code: bk,
          packing: ln.packing,
          so_no: ln.so_no,
          mod_reason: header.mod_reason,
          marka: ln.marka,
          cost_code: ln.cost_code,
        });
      }
    });

    return {
      ok: true,
      bill_no,
      bill_date: formatDateOut(bdt),
      dc_type: dcType,
      bill_amt,
      message: `${dcType === 'DR' ? 'DC Return' : 'Dispatch Challan'} saved.`,
    };
  }

  async function deleteDispatchChallan(comp_code, comp_uid, dcType, bill_no, b_type, user_name) {
    await assertDchalanPermission(user_name, comp_uid, 'delete');
    const cc = Number(comp_code) || 0;
    const no = Number(bill_no) || 0;
    if (!no) {
      const err = new Error('Challan number is required.');
      err.status = 400;
      throw err;
    }
    const bt = String(b_type ?? 'N').trim() || 'N';
    await runInCompTx(comp_uid, async (exec) => {
      const q = makeQuery(comp_uid, exec);
      const existing = await loadDispatchChallan(cc, comp_uid, dcType, no, bt).catch(() => null);
      if (!existing) {
        const err = new Error(`${dcType === 'DR' ? 'DC Return' : 'Dispatch Challan'} not found.`);
        err.status = 404;
        throw err;
      }
      await q(
        `DELETE FROM SALE
         WHERE COMP_CODE = :comp_code AND TRIM(TYPE) = TRIM(:type)
           AND BILL_NO = :bill_no AND NVL(TRIM(B_TYPE), 'N') = NVL(TRIM(:b_type), 'N')`,
        { comp_code: cc, type: dcType, bill_no: no, b_type: bt }
      );
    });
    return { ok: true, message: `${dcType === 'DR' ? 'DC Return' : 'Dispatch Challan'} deleted.` };
  }

  function requireDcType(req, res) {
    const dcType = normDcType(req.query.dc_type ?? req.query.type);
    if (!dcType) {
      res.status(400).json({ error: "dc_type must be 'DC' or 'DR'." });
      return null;
    }
    return dcType;
  }

  function registerRoutes(app) {
    app.get('/api/dispatch-challan/user-permissions', async (req, res) => {
      try {
        const { comp_uid, user_name } = req.query;
        if (comp_uid == null || String(comp_uid).trim() === '' || !user_name) {
          return res.status(400).json({ error: 'comp_uid and user_name are required' });
        }
        const data = await fetchDchalanUserPermissions(String(user_name));
        res.json(data);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/context', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const wgt_kq = await fetchWgtKq(comp_code, comp_uid);
        const sale_order_type = await fetchSaleOrderType(comp_code, comp_uid);
        const costRows = await runQuery(
          `SELECT TRIM(COST_CODE) AS COST_CODE, TRIM(COST_NAME) AS COST_NAME
           FROM COST WHERE COMP_CODE = :comp_code ORDER BY COST_NAME`,
          { comp_code: Number(comp_code) || 0 },
          comp_uid
        ).catch(() => []);
        const costs = (costRows || []).map((r) => ({
          cost_code: normCode(r.COST_CODE ?? r.cost_code),
          cost_name: String(r.COST_NAME ?? r.cost_name ?? '').trim(),
        }));
        res.json({ ok: true, wgt_kq, sale_order_type, costs });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/next-no', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const dcType = requireDcType(req, res);
        if (!dcType) return;
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const bill_no = await fetchNextBillNo(comp_code, comp_uid, dcType);
        res.json({ ok: true, bill_no, type: dcType });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/list', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sdt, edt, party } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const dcType = requireDcType(req, res);
        if (!dcType) return;
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const rows = await listDispatchChallans(comp_code, comp_uid, dcType, { sdt, edt, party });
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/list error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/checklist', async (req, res) => {
      try {
        const {
          comp_code,
          comp_uid,
          user_name,
          sdt,
          edt,
          code,
          item_code,
          sup_code,
          bk_code,
          mlc,
          city,
          sbno,
          ebno,
          b_type,
        } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const dcType = requireDcType(req, res);
        if (!dcType) return;
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const data = await fetchChecklist(comp_code, comp_uid, dcType, {
          sdt,
          edt,
          code,
          item_code,
          sup_code,
          bk_code,
          mlc,
          city,
          sbno,
          ebno,
          b_type,
        });
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/checklist error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/checklist-cities', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const rows = await fetchChecklistCities(comp_code, comp_uid);
        res.json({ ok: true, rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/checklist-cities error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/pending', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, sdt, edt, code } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const rows = await fetchPending(comp_code, comp_uid, { sdt, edt, code });
        res.json(rows);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/pending error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/marka-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const rows = await runQuery(
          `SELECT MARKA
           FROM MARKA
           WHERE COMP_CODE = :comp_code
           ORDER BY 1`,
          { comp_code: Number(comp_code) || 0 },
          comp_uid
        ).catch(() => []);
        const mapped = (rows || [])
          .map((r) => {
            const marka = String(r.MARKA ?? r.marka ?? '').trim();
            return marka ? { marka, MARKA: marka } : null;
          })
          .filter(Boolean);
        res.json({ ok: true, rows: mapped });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/marka-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/lot-stock-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, bill_date, item_code, sup_code, remarks } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const rows = await fetchLotStockHelp(comp_code, comp_uid, {
          bill_date,
          item_code,
          sup_code,
          remarks,
        });
        res.json({ ok: true, rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/lot-stock-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan/sales-order-help', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, master_code, item_code } = req.query;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const rows = await fetchSalesOrderHelp(comp_code, comp_uid, { master_code, item_code });
        res.json({ ok: true, rows });
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan/sales-order-help error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.get('/api/dispatch-challan', async (req, res) => {
      try {
        const { comp_code, comp_uid, user_name, bill_no, b_type } = req.query;
        if (!comp_code || !bill_no) {
          return res.status(400).json({ error: 'comp_code and bill_no are required' });
        }
        const dcType = requireDcType(req, res);
        if (!dcType) return;
        await assertDchalanPermission(user_name, comp_uid, 'access');
        const data = await loadDispatchChallan(comp_code, comp_uid, dcType, bill_no, b_type);
        res.json(data);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan GET error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.post('/api/dispatch-challan', async (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = body.comp_code ?? body.COMP_CODE;
        const comp_year = body.comp_year ?? body.COMP_YEAR ?? 0;
        const comp_uid = body.comp_uid ?? body.COMP_UID;
        if (!comp_code) return res.status(400).json({ error: 'comp_code is required' });
        const result = await saveDispatchChallan(comp_code, comp_year, comp_uid, body, req);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan POST error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });

    app.delete('/api/dispatch-challan', async (req, res) => {
      try {
        const q = req.query || {};
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const comp_code = q.comp_code ?? body.comp_code;
        const comp_uid = q.comp_uid ?? body.comp_uid;
        const bill_no = q.bill_no ?? body.bill_no;
        const b_type = q.b_type ?? body.b_type;
        const dcType = normDcType(q.dc_type ?? body.dc_type);
        const user_name = resolveUserName(body, req);
        if (!comp_code || !bill_no) {
          return res.status(400).json({ error: 'comp_code and bill_no are required' });
        }
        if (!dcType) return res.status(400).json({ error: "dc_type must be 'DC' or 'DR'." });
        const result = await deleteDispatchChallan(comp_code, comp_uid, dcType, bill_no, b_type, user_name);
        res.json(result);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('❌ dispatch-challan DELETE error:', err.message);
        res.status(status).json({ error: err.message });
      }
    });
  }

  return {
    registerRoutes,
    loadDispatchChallan,
    saveDispatchChallan,
    deleteDispatchChallan,
    fetchNextBillNo,
  };
}

module.exports = { createDispatchChallan };
